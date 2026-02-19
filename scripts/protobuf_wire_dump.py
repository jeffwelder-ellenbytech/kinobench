#!/usr/bin/env python3
"""
Quick-and-dirty Protobuf wire-format dumper (no .proto needed).

Usage:
  - Dump a hex string:
      python3 scripts/protobuf_wire_dump.py --hex <hexbytes>
  - Dump all FF09 blobs from JSONL produced by extract_btsnoop_att.py:
      python3 scripts/protobuf_wire_dump.py --jsonl /tmp/a2687_att.jsonl

This is intended for reverse-engineering: it prints field numbers, wire types,
lengths, and a few interpretations (ASCII/UTF-8 / nested message heuristic).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import Iterable, Optional


def read_varint(buf: bytes, off: int) -> tuple[int, int]:
    v = 0
    shift = 0
    start = off
    while off < len(buf) and shift <= 63:
        b = buf[off]
        off += 1
        v |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return v, off
        shift += 7
    raise ValueError(f"unterminated varint at {start}")


def is_mostly_printable(b: bytes) -> bool:
    if not b:
        return False
    printable = sum(1 for x in b if 32 <= x <= 126 or x in (9, 10, 13))
    return printable / len(b) >= 0.85


def try_utf8(b: bytes) -> Optional[str]:
    try:
        s = b.decode("utf-8")
    except Exception:
        return None
    # Keep this conservative.
    if not s:
        return None
    if any(ord(ch) < 9 for ch in s):
        return None
    if sum(1 for ch in s if ch.isprintable()) / len(s) < 0.85:
        return None
    return s


def looks_like_embedded_message(b: bytes) -> bool:
    # Heuristic: a few valid tags in sequence, no huge lengths.
    off = 0
    ok = 0
    try:
        for _ in range(5):
            if off >= len(b):
                break
            tag, off2 = read_varint(b, off)
            if tag == 0:
                break
            field = tag >> 3
            wt = tag & 0x7
            if field <= 0 or field > 2048:
                break
            off = off2
            if wt == 0:
                _, off = read_varint(b, off)
            elif wt == 1:
                off += 8
            elif wt == 2:
                ln, off = read_varint(b, off)
                if ln > 4096:
                    break
                off += ln
            elif wt == 5:
                off += 4
            else:
                break
            if off > len(b):
                break
            ok += 1
    except Exception:
        return False
    return ok >= 2


@dataclass(frozen=True)
class Field:
    field_no: int
    wire_type: int
    value: object
    start: int
    end: int


def parse_message(buf: bytes, *, depth: int = 0, max_fields: int = 200) -> list[Field]:
    fields: list[Field] = []
    off = 0
    n = 0
    while off < len(buf) and n < max_fields:
        start = off
        tag, off = read_varint(buf, off)
        if tag == 0:
            break
        field_no = tag >> 3
        wt = tag & 0x7
        if wt == 0:
            v, off = read_varint(buf, off)
            fields.append(Field(field_no, wt, v, start, off))
        elif wt == 1:
            if off + 8 > len(buf):
                break
            v = int.from_bytes(buf[off : off + 8], "little")
            off2 = off + 8
            fields.append(Field(field_no, wt, v, start, off2))
            off = off2
        elif wt == 2:
            ln, off = read_varint(buf, off)
            if off + ln > len(buf):
                break
            b = buf[off : off + ln]
            off2 = off + ln

            # Attempt interpretations.
            interp: dict[str, object] = {"len": ln, "hex": b.hex()}
            s = try_utf8(b)
            if s is not None:
                interp["utf8"] = s
            elif is_mostly_printable(b):
                interp["ascii"] = b.decode("latin1", errors="replace")
            elif looks_like_embedded_message(b) and depth < 3:
                interp["embedded"] = [f for f in parse_message(b, depth=depth + 1, max_fields=50)]

            fields.append(Field(field_no, wt, interp, start, off2))
            off = off2
        elif wt == 5:
            if off + 4 > len(buf):
                break
            v = int.from_bytes(buf[off : off + 4], "little")
            off2 = off + 4
            fields.append(Field(field_no, wt, v, start, off2))
            off = off2
        else:
            break
        n += 1
    return fields


def fmt_fields(fields: list[Field], indent: str = "") -> str:
    lines: list[str] = []
    for f in fields:
        if f.wire_type == 2 and isinstance(f.value, dict) and "embedded" in f.value:
            lines.append(f"{indent}{f.field_no}: wt=2 len={f.value.get('len')} embedded:")
            embedded = f.value["embedded"]
            lines.append(fmt_fields(embedded, indent + "  "))
        elif f.wire_type == 2 and isinstance(f.value, dict):
            tail = ""
            if "utf8" in f.value:
                tail = f" utf8={f.value['utf8']!r}"
            elif "ascii" in f.value:
                tail = f" ascii={f.value['ascii']!r}"
            lines.append(f"{indent}{f.field_no}: wt=2 len={f.value.get('len')} hex={f.value.get('hex')[:64]}{tail}")
        else:
            lines.append(f"{indent}{f.field_no}: wt={f.wire_type} value={f.value}")
    return "\n".join(lines)


def dump_hex(label: str, buf: bytes) -> None:
    print(f"{label}: {len(buf)} bytes")
    try:
        fields = parse_message(buf)
        if not fields:
            print("  (no fields parsed)")
        else:
            print(fmt_fields(fields, indent="  "))
    except Exception as e:
        print(f"  parse error: {e}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hex", help="Hex bytes (no separators)")
    ap.add_argument("--jsonl", help="JSONL from extract_btsnoop_att.py")
    ap.add_argument("--frame", type=int, default=0, help="If set, only dump this frame number from --jsonl")
    args = ap.parse_args()

    if args.hex:
        dump_hex("input", bytes.fromhex(args.hex))
        return 0

    if args.jsonl:
        for line in open(args.jsonl, "r", encoding="utf-8"):
            o = json.loads(line)
            if args.frame and int(o.get("frame", 0)) != args.frame:
                continue
            hx = o.get("value_hex", "")
            if not hx:
                continue
            raw = bytes.fromhex(hx)
            if len(raw) < 10 or raw[:2] != b"\xff\x09":
                continue
            payload = raw[4:-1]
            if len(payload) < 5 or payload[:2] != b"\x03\x00":
                continue
            group = payload[2]
            cmd_high = payload[3]
            cmd_low = payload[4]
            cmd = (cmd_high << 8) | cmd_low
            base_cmd = ((cmd_high & ~(0x40 | 0x08)) << 8) | cmd_low
            blob = payload[5:]
            print(f"frame={o.get('frame')} op={o.get('opcode')} h={o.get('att_handle')} group=0x{group:02x} cmd=0x{cmd:04x} base=0x{base_cmd:04x} blob_len={len(blob)}")
            dump_hex("  blob", blob)
            print()
        return 0

    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

