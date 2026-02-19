import argparse
import asyncio
import struct
from binascii import hexlify, unhexlify

from bleak import BleakClient, BleakScanner


def to_bytes(s: str) -> bytes:
    return unhexlify(s.replace(" ", ""))


def add_crc(data: bytes) -> bytes:
    crc = (256 - (sum(data) % 256)) & 0xFF
    return data + bytes([crc])


def format_props(char) -> str:
    try:
        return ",".join(char.properties)
    except Exception:
        return ""


def is_crc_valid(packet: bytes) -> bool:
    if not packet:
        return False
    return ((sum(packet[:-1]) + packet[-1]) & 0xFF) == 0


def decode_status_packet(packet: bytes) -> dict:
    return {
        "len": len(packet),
        "setpoint": struct.unpack("<f", packet[23:27])[0],
        "temp": struct.unpack("<f", packet[19:23])[0],
        "current": struct.unpack("<f", packet[11:15])[0],
        "voltage": struct.unpack("<f", packet[7:11])[0],
        "unk1": packet[4],
        "run": packet[6],
        "mode": packet[5] & 0x0F,
        "fan": packet[5] >> 4,
        "run_time": struct.unpack("<l", packet[15:19])[0],
        "crc_ok": is_crc_valid(packet),
    }


def infer_chars(services, write_char: str | None, notify_char: str | None):
    write = write_char.lower() if write_char else None
    notify = notify_char.lower() if notify_char else None
    chars = {}
    for svc in services:
        for ch in svc.characteristics:
            chars[ch.uuid.lower()] = set(ch.properties or [])

    if write is None:
        if "0000fff3-0000-1000-8000-00805f9b34fb" in chars:
            write = "0000fff3-0000-1000-8000-00805f9b34fb"
        elif "0000fff1-0000-1000-8000-00805f9b34fb" in chars:
            write = "0000fff1-0000-1000-8000-00805f9b34fb"

    if notify is None:
        if "0000fff2-0000-1000-8000-00805f9b34fb" in chars:
            notify = "0000fff2-0000-1000-8000-00805f9b34fb"
        elif "0000fff1-0000-1000-8000-00805f9b34fb" in chars:
            notify = "0000fff1-0000-1000-8000-00805f9b34fb"

    return write, notify


async def pick_device(address: str | None, name_hint: str | None, timeout: float):
    if address:
        return address

    print(f"Scanning for BLE devices ({timeout:.1f}s)...")
    devices = await BleakScanner.discover(timeout=timeout)
    if not devices:
        raise RuntimeError("No BLE devices found.")

    if name_hint:
        for dev in devices:
            name = dev.name or ""
            if name_hint.lower() in name.lower():
                print(f"Matched device: {name} [{dev.address}]")
                return dev.address

    print("No name match found; available devices:")
    for dev in devices:
        print(f"- {dev.name or '(unknown)'} [{dev.address}]")
    raise RuntimeError("Provide --address or a better --name hint.")


async def main():
    parser = argparse.ArgumentParser(
        description="BLE GATT probe for Alientek devices using bleak."
    )
    parser.add_argument("--address", help="BLE address/identifier to connect to")
    parser.add_argument(
        "--name",
        default="EL15_BLE",
        help="Name hint used during scan if --address is not provided (default: EL15_BLE)",
    )
    parser.add_argument(
        "--scan-timeout", type=float, default=8.0, help="BLE scan timeout seconds"
    )
    parser.add_argument(
        "--write-char",
        help="Write characteristic UUID for sending command packets",
    )
    parser.add_argument(
        "--notify-char",
        help="Notify characteristic UUID for receiving packets",
    )
    parser.add_argument(
        "--query",
        action="store_true",
        help="Send default query packet AF 07 03 08 00 + CRC (requires --write-char)",
    )
    parser.add_argument(
        "--raw-hex",
        help="Send raw hex payload (without CRC). CRC is appended automatically. Requires --write-char",
    )
    parser.add_argument(
        "--listen-seconds",
        type=float,
        default=5.0,
        help="How long to listen for notifications after write (default: 5)",
    )
    parser.add_argument(
        "--poll",
        action="store_true",
        help="Continuously send query AF 07 03 08 00 + CRC (default behavior when no --raw-hex)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Polling interval seconds (default: 1.0)",
    )
    args = parser.parse_args()

    target = await pick_device(args.address, args.name, args.scan_timeout)

    def on_notify(_: str, data: bytearray):
        pkt = bytes(data)
        hex_data = hexlify(pkt).decode()
        print(f"notify {len(pkt)} bytes: {hex_data}")
        if len(pkt) >= 28 and pkt[0:4] == bytes.fromhex("df070308"):
            try:
                print(f"decoded: {decode_status_packet(pkt[:28])}")
            except Exception as exc:
                print(f"decode error: {exc}")

    async with BleakClient(target) as client:
        print(f"Connected: {client.is_connected}")

        services = client.services
        if not services:
            raise RuntimeError("No services discovered after connect.")
        print("\nDiscovered services/characteristics:")
        for svc in services:
            print(f"[Service] {svc.uuid}")
            for ch in svc.characteristics:
                print(f"  - {ch.uuid}  props={format_props(ch)}")

        write_char, notify_char = infer_chars(services, args.write_char, args.notify_char)
        if write_char:
            print(f"\nUsing write characteristic: {write_char}")
        if notify_char:
            print(f"Using notify characteristic: {notify_char}")

        if notify_char:
            print(f"\nStarting notifications on: {notify_char}")
            await client.start_notify(notify_char, on_notify)

        payload = None
        if args.query:
            payload = add_crc(to_bytes("AF 07 03 08 00"))
        elif args.raw_hex:
            payload = add_crc(to_bytes(args.raw_hex))

        should_poll = args.poll or (payload is None and args.raw_hex is None)
        if should_poll:
            if not write_char:
                raise RuntimeError("Polling requires a write characteristic.")
            query_payload = add_crc(to_bytes("AF 07 03 08 00"))
            print(
                f"\nPolling started. interval={args.interval:.2f}s payload={hexlify(query_payload).decode()}"
            )
            print("Press Ctrl+C to stop.")
            try:
                while True:
                    await client.write_gatt_char(write_char, query_payload, response=False)
                    await asyncio.sleep(args.interval)
            except KeyboardInterrupt:
                pass
        elif payload is not None:
            if not write_char:
                raise RuntimeError("Writing requires --write-char or detectable default.")
            print(f"\nWriting {len(payload)} bytes: {hexlify(payload).decode()}")
            await client.write_gatt_char(write_char, payload, response=False)
            await asyncio.sleep(args.listen_seconds)
        elif notify_char:
            print(f"\nListening for notifications for {args.listen_seconds}s...")
            await asyncio.sleep(args.listen_seconds)

        if notify_char:
            await client.stop_notify(notify_char)


if __name__ == "__main__":
    asyncio.run(main())
