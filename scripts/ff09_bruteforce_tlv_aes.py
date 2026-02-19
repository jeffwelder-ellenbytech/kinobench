#!/usr/bin/env python3
"""
Heuristic brute-force helper for Anker FF09-framed packets captured in btsnoop JSONL.

Purpose:
- Given captured `ff09 ...` frames (like from scripts/extract_btsnoop_att.py --jsonl),
  try to locate an AES-CBC ciphertext region and decrypt it under a small set of
  plausible key/IV candidates.
- Score decrypted plaintext by "TLV-likeness" (type,len,value) with Anker-ish types
  (0xA0-0xFF) and optional leading 0x00 byte.

This won't magically recover keys. It is meant to quickly answer:
- "Is this AES-CBC TLV at all?"
- "Which offset seems to be ciphertext?"
- "Do any obvious key/IV candidates produce plausible TLV plaintext?"
"""

from __future__ import annotations

import argparse
import json
import string
from dataclasses import dataclass
from typing import Iterable

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


def parse_hex(s: str) -> bytes:
    s = s.strip().lower().replace(":", "")
    return bytes.fromhex(s) if s else b""


def xor_checksum(data: bytes) -> int:
    cs = 0
    for b in data:
        cs ^= b
    return cs


def tlv_parse(buf: bytes) -> tuple[int, int, list[tuple[int, bytes]]]:
    """
    Parse TLVs of format: [type:1][len:1][value:len]...
    Returns: (parsed_bytes, errors, items)
    """
    off = 0
    items: list[tuple[int, bytes]] = []
    errors = 0
    while off + 2 <= len(buf):
        t = buf[off]
        l = buf[off + 1]
        off += 2
        if off + l > len(buf):
            errors += 1
            break
        v = buf[off : off + l]
        items.append((t, v))
        off += l
    if off != len(buf):
        # trailing bytes are "error-ish"
        errors += 1
    return off, errors, items


def score_tlv_plaintext(pt: bytes) -> tuple[float, str]:
    # Optional leading 0x00 is seen in some implementations.
    pt2 = pt[1:] if pt[:1] == b"\x00" else pt

    parsed, errors, items = tlv_parse(pt2)
    if not items:
        return 0.0, "no_tlvs"

    # Reward recognizable Anker TLV type range.
    a_types = sum(1 for (t, _v) in items if 0xA0 <= t <= 0xFF)
    good_types = sum(1 for (t, _v) in items if t in (0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAE))

    # Filter out obvious random false-positives where we "parse" a single TLV by chance.
    if len(items) == 1 and good_types == 0:
        return 0.0, "single_tlv_unrecognized"

    # Require at least 2 TLVs unless we see a known-good type.
    if len(items) < 2 and good_types == 0:
        return 0.0, "too_few_tlvs"

    # Reward if any value looks ASCII-ish (serial/firmware).
    asciiish = 0
    for _t, v in items:
        if not v:
            continue
        printable = sum(1 for b in v if 32 <= b <= 126)
        if printable / len(v) >= 0.85 and len(v) >= 6:
            asciiish += 1

    # Parse coverage and penalty for parse errors.
    coverage = parsed / max(1, len(pt2))
    score = 10.0 * coverage
    score += 2.0 * a_types
    score += 4.0 * good_types
    score += 2.0 * asciiish
    score -= 10.0 * errors

    # Summary string for debugging.
    types = " ".join(f"{t:02x}({len(v)})" for (t, v) in items[:8])
    if len(items) > 8:
        types += f" ... (+{len(items)-8})"
    return score, types


def aes_cbc_decrypt(ct: bytes, key: bytes, iv: bytes) -> bytes:
    if len(key) != 16 or len(iv) != 16:
        raise ValueError("key/iv must be 16 bytes")
    if len(ct) % 16 != 0:
        raise ValueError("ciphertext must be 16-byte aligned")
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    return decryptor.update(ct) + decryptor.finalize()


def iv_candidates(blob: bytes, peer_mac: bytes, k0: bytes, k1: bytes) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    out.append(("iv_zero", b"\x00" * 16))
    out.append(("iv_k0", k0))
    out.append(("iv_k1", k1))
    if len(peer_mac) == 6:
        out.append(("iv_peer_mac_pad0", peer_mac + b"\x00" * 10))
        out.append(("iv_peer_mac_rev_pad0", peer_mac[::-1] + b"\x00" * 10))
    if len(blob) >= 16:
        out.append(("iv_blob0_16", blob[:16]))
    if len(blob) >= 4:
        out.append(("iv_blob0_4_x4", (blob[:4] * 4)[:16]))
    return out


def key_candidates(k0: bytes, k1: bytes) -> list[tuple[str, bytes]]:
    return [("key_k0", k0), ("key_k1", k1)]


@dataclass(frozen=True)
class Candidate:
    score: float
    frame: int
    opcode: str
    att_handle: str
    group: int
    cmd: int
    base_cmd: int
    ct_off: int
    ct_len: int
    key_name: str
    iv_name: str
    pt0_hex: str
    tlv_summary: str


def iter_ct_segments(blob: bytes, max_off: int = 32) -> Iterable[tuple[int, bytes]]:
    # Try reasonable offsets to account for small per-message headers.
    max_off = min(max_off, len(blob))
    for off in range(0, max_off + 1):
        ct = blob[off:]
        if len(ct) >= 16 and len(ct) % 16 == 0:
            yield off, ct
    # Also try taking the *tail* (common with MIC/tag prefixes).
    for tail_len in (16, 32, 48, 64, 80, 96, 112, 128):
        if tail_len <= len(blob) and tail_len % 16 == 0:
            yield len(blob) - tail_len, blob[-tail_len:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl", help="JSONL output from extract_btsnoop_att.py --jsonl")
    ap.add_argument("--peer", default="", help="Peer BD_ADDR (optional, for IV heuristics), e.g. 7c:e9:13:6e:4d:75")
    ap.add_argument(
        "--a2",
        default="32633337376466613039636462373932343838396534323932613337663631633863356564353264",
        help="A2_STATIC_HEX (default from src/services/anker-ble.ts)",
    )
    ap.add_argument("--top", type=int, default=15, help="Show top N candidates")
    ap.add_argument("--max-off", type=int, default=32, help="Max ciphertext start offset to try inside blob")
    args = ap.parse_args()

    a2 = bytes.fromhex(args.a2)
    if len(a2) < 32:
        raise SystemExit("A2 must be >= 32 bytes hex")
    k0 = a2[:16]
    k1 = a2[16:32]

    peer_mac = b""
    if args.peer:
        peer_mac = bytes(int(x, 16) for x in args.peer.split(":"))

    candidates: list[Candidate] = []

    for line in open(args.jsonl, "r", encoding="utf-8"):
        o = json.loads(line)
        hx = o.get("value_hex", "")
        if not hx or not hx.startswith("ff09"):
            continue

        raw = bytes.fromhex(hx)
        if len(raw) < 10:
            continue
        if raw[0] != 0xFF or raw[1] != 0x09:
            continue

        decl_len = int.from_bytes(raw[2:4], "little")
        payload = raw[4:-1]  # includes 03 00 group cmdHigh cmdLow ...
        if len(payload) < 5:
            continue
        if payload[0] != 0x03 or payload[1] != 0x00:
            continue

        group = payload[2]
        cmd_high = payload[3]
        cmd_low = payload[4]
        cmd = (cmd_high << 8) | cmd_low
        base_cmd = ((cmd_high & ~(0x40 | 0x08)) << 8) | cmd_low

        blob = payload[5:]
        if not blob:
            continue

        ivs = iv_candidates(blob, peer_mac, k0, k1)
        keys = key_candidates(k0, k1)

        for ct_off, ct in iter_ct_segments(blob, max_off=args.max_off):
            for key_name, key in keys:
                for iv_name, iv in ivs:
                    try:
                        pt = aes_cbc_decrypt(ct, key, iv)
                    except Exception:
                        continue
                    score, tlv_summary = score_tlv_plaintext(pt)
                    if score <= 0:
                        continue
                    candidates.append(
                        Candidate(
                            score=score,
                            frame=int(o.get("frame", -1)),
                            opcode=str(o.get("opcode", "")),
                            att_handle=str(o.get("att_handle", "")),
                            group=group,
                            cmd=cmd,
                            base_cmd=base_cmd,
                            ct_off=ct_off,
                            ct_len=len(ct),
                            key_name=key_name,
                            iv_name=iv_name,
                            pt0_hex=pt[:32].hex(),
                            tlv_summary=tlv_summary,
                        )
                    )

    candidates.sort(key=lambda c: c.score, reverse=True)
    for c in candidates[: args.top]:
        print(
            f"score={c.score:6.2f} frame={c.frame} op={c.opcode} h={c.att_handle} "
            f"group=0x{c.group:02x} cmd=0x{c.cmd:04x} base=0x{c.base_cmd:04x} "
            f"ct_off={c.ct_off} ct_len={c.ct_len} {c.key_name} {c.iv_name} "
            f"pt0={c.pt0_hex} tlv={c.tlv_summary}"
        )

    if not candidates:
        print("No plausible TLV decrypt candidates found.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
