import binascii
import socket
import struct
import sys
from binascii import unhexlify


def to_bytes(s):
    return unhexlify(s.replace(" ", ""))


def add_crc(data):
    crc = 256 - sum(data) % 256
    return data + struct.pack("B", crc)


def decode_packet_bytes(packet: bytes) -> dict:
    """
    Decode a binary packet (28 bytes) into parsed fields.
    """
    print(binascii.hexlify(packet[23:27]))

    # df 07 03 08 16 41 02 b8 4a 66 41 2a 15 9e 3f 6b 00 00 00 88 80 23 42 7b 14 9e 3f ad
    # 0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27
    # <-header->           <-volt----> <-current-> <--time---> <-temp--->  <---setp->   | ^------ crc

    return {
        "len": len(packet),
        "setpoint": struct.unpack("<f", packet[23:27])[0],
        "temp": struct.unpack("<f", packet[19:23])[0],
        "current": struct.unpack("<f", packet[11:15])[0],
        "voltage": struct.unpack("<f", packet[7:11])[0],
        "unk1": packet[4],
        "run": packet[6],
        "mode": packet[5] & 0x0F,
        "fan": hex(packet[5] >> 4),
        "run_time": struct.unpack("<l", packet[15:19])[0],
    }


if not hasattr(socket, "AF_BLUETOOTH"):
    raise RuntimeError(
        "This Python build/platform does not expose socket.AF_BLUETOOTH.\n"
        "RFCOMM sockets in this script require Linux BlueZ.\n"
        "On macOS, use Linux (or Raspberry Pi) for RFCOMM, or switch to BLE GATT tooling."
    )

s = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
s.connect(("F8:42:8A:03:33:0B", 1))

try:
    while True:
        packet = add_crc(to_bytes("af 07 03 08 00"))  # query
        # packet = add_crc(to_bytes("af 07 03 09 01 00")) # unlock
        # packet = add_crc(to_bytes("af 07 03 09 01 01")) # lock
        # packet = add_crc(to_bytes("af 07 03 09 01 00")) # load off
        # packet = add_crc(to_bytes("af 07 03 09 01 04")) # load on
        # packet = add_crc(to_bytes("af 07 03 04 04 00 00 80 3F"))  # set params current 1.0A
        # packet = add_crc(to_bytes("af 07 03 04 04") + struct.pack("<f", 1.234))  # 1.234A
        # packet = add_crc(to_bytes("af 07 03 03 01 09")) # mode CV
        # packet = add_crc(to_bytes("af 07 03 03 01 01")) # mode CC
        # packet = add_crc(to_bytes("af 07 03 03 01 02")) # mode Battery CAP
        # packet = add_crc(to_bytes("af 07 03 03 01 0a")) # mode Battery DCR
        # packet = add_crc(to_bytes("af 07 03 03 01 11")) # mode CR
        # packet = add_crc(to_bytes("af 07 03 03 01 19")) # mode CP

        # packet = add_crc(to_bytes("af FF FF 00 00"))  # discovery? Answer DF FF FF 00 02 07 03
        # packet = add_crc(to_bytes("AF 07 03 07 00"))  # get name
        # packet = add_crc(to_bytes("AF 07 03 06 0A 45 4C 31 36 00 00 00 00 00 00")) # set name to EL16

        s.send(packet)
        data = s.recv(1024)
        print(binascii.hexlify(packet))
        print(binascii.hexlify(data))
        print(data)
        print(decode_packet_bytes(data))
except KeyboardInterrupt:
    print("\nStopping probe.", file=sys.stderr)
finally:
    s.close()
