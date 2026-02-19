#!/usr/bin/env python3
"""
Extract ATT/GATT payloads for a given BLE peer from an Android btsnoop_hci.log.

This is a pragmatic wrapper around tshark (Wireshark CLI) because it already
handles Android's btsnoop DLT and ATT dissection.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class AttRow:
    frame: int
    t_epoch: str
    opcode: str
    att_handle: str
    value_hex: str

    def as_json(self) -> str:
        b = bytes.fromhex(self.value_hex) if self.value_hex else b""
        hdr = None
        if len(b) >= 8 and b[:2] == b"\xFF\x09":
            # Observed structure in Anker captures:
            # ff 09 <len_le:2> <...>
            decl_len = int.from_bytes(b[2:4], "little")
            hdr = {
                "magic": "ff09",
                "decl_len_le": decl_len,
                "actual_len": len(b),
                "word0_le": int.from_bytes(b[4:6], "little"),
                "word1_le": int.from_bytes(b[6:8], "little"),
            }
        return json.dumps(
            {
                "frame": self.frame,
                "t_epoch": self.t_epoch,
                "opcode": self.opcode,
                "att_handle": self.att_handle,
                "value_hex": self.value_hex,
                "ff09_header": hdr,
            },
            sort_keys=True,
        )


def run(*cmd: str) -> str:
    p = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    return p.stdout


def require_tshark() -> str:
    tshark = shutil.which("tshark")
    if not tshark:
        raise SystemExit("tshark not found on PATH")
    return tshark


def find_conn_handle(tshark: str, pcap: str, peer: str) -> str:
    # Match reversed BD_ADDR bytes (as they appear in many HCI events).
    peer_bytes = bytes(int(x, 16) for x in peer.split(":"))
    rev = ":".join(f"{b:02x}" for b in peer_bytes[::-1])

    # LE Enhanced Connection Complete [v1] is subevent 0x0a.
    out = run(
        tshark,
        "-r",
        pcap,
        "-Y",
        f"bthci_evt.le_meta_subevent == 0x0a && frame contains {rev}",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "frame.number",
        "-e",
        "bthci_evt.connection_handle",
    ).strip()

    if not out:
        raise SystemExit(f"Could not find LE Enhanced Connection Complete for peer {peer}")

    # If multiple matches, pick the last (most recent).
    last = out.splitlines()[-1]
    _frame, ch = last.split("\t", 1)
    if not ch:
        raise SystemExit("Found connection complete, but no connection_handle field")
    return ch


def iter_att(tshark: str, pcap: str, chandle: str) -> list[AttRow]:
    # Focus on payload-bearing opcodes by default:
    # 0x52 Write Command, 0x12 Write Request, 0x1b Handle Value Notification, 0x1d Indication,
    # 0x0b Read Response, 0x13 Write Response.
    filt = (
        f"bthci_acl.chandle == {chandle} && "
        "(btatt.opcode == 0x52 || btatt.opcode == 0x12 || btatt.opcode == 0x1b || "
        " btatt.opcode == 0x1d || btatt.opcode == 0x0b || btatt.opcode == 0x13)"
    )
    out = run(
        tshark,
        "-r",
        pcap,
        "-Y",
        filt,
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "frame.number",
        "-e",
        "frame.time_epoch",
        "-e",
        "btatt.opcode",
        "-e",
        "btatt.handle",
        "-e",
        "btatt.value",
    ).strip()

    rows: list[AttRow] = []
    if not out:
        return rows

    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        frame_s, t_epoch, opcode, att_handle, value = parts[:5]
        # tshark may emit bytes as "aa:bb:cc". Normalize to hex string without separators.
        value_hex = value.replace(":", "").strip().lower()
        rows.append(
            AttRow(
                frame=int(frame_s),
                t_epoch=t_epoch,
                opcode=opcode,
                att_handle=att_handle,
                value_hex=value_hex,
            )
        )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("btsnoop", help="Path to btsnoop_hci.log")
    ap.add_argument("--peer", required=True, help="Peer BD_ADDR, e.g. 7c:e9:13:6e:4d:75")
    ap.add_argument("--jsonl", action="store_true", help="Emit JSONL (one object per ATT PDU)")
    args = ap.parse_args()

    tshark = require_tshark()
    chandle = find_conn_handle(tshark, args.btsnoop, args.peer.lower())
    rows = iter_att(tshark, args.btsnoop, chandle)

    if args.jsonl:
        for r in rows:
            print(r.as_json())
    else:
        print(f"peer={args.peer} chandle={chandle} att_pdus={len(rows)}")
        for r in rows:
            prefix = f"{r.frame}\t{r.t_epoch}\t{r.opcode}\t{r.att_handle}\t"
            print(prefix + (r.value_hex or ""))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

