# A2687 BLE HCI Snoop Analysis - Port Switch Commands

## Capture Details
- **Source**: Pixel 7 Pro BLE HCI snoop log via `adb bugreport`
- **File**: `bugreport/FS/data/misc/bluetooth/logs/btsnoop_hci.log`
- **Device**: Anker A2687 160W Prime Charger (serial: ASHDJW61F46301008)
- **ATT Write Handle**: `0x000c`
- **GATT Write Char**: `8c850002-0302-41c5-b46e-cf057c562025`
- **GATT Notify Char**: `8c850003-0302-41c5-b46e-cf057c562025`

## Identified Port Switch Frames

The following Wireshark frames correspond to port on/off toggle commands sent by the official Anker app (v3.17.0):

| Frame | Action   | Port | Direction |
|-------|----------|------|-----------|
| 1440  | C1 OFF   | USB-C1 | TX (Write Command 0x52) |
| 1447  | C1 ON    | USB-C1 | TX (Write Command 0x52) |
| 1453  | C2 OFF   | USB-C2 | TX (Write Command 0x52) |
| 1457  | C2 ON    | USB-C2 | TX (Write Command 0x52) |
| 1462  | USB-A OFF| USB-A  | TX (Write Command 0x52) |
| 1466  | USB-A ON | USB-A  | TX (Write Command 0x52) |

## Packet Structure (Official App)

All port switch commands follow the same framing:

```
FF 09 [len_lo len_hi] 03 00 [group|flags] [cmd_hi cmd_lo] [ciphertext...] [xor_checksum]
```

### Header breakdown
- `FF 09` - Frame header (constant)
- `len_lo len_hi` - Little-endian uint16 payload length (after header, before XOR)
- `03 00` - Command header (constant)
- Group+Flags byte: `0x4F` = GROUP_ACTION (`0x0f`) | COMMAND_FLAG_ENCRYPTED (`0x40`)
- Command: `0x02 0x07` = CMD_CHARGER_PORT_SWITCH (`0x0207`)
- Ciphertext: AES-CBC encrypted TLV payload
- Last byte: XOR checksum of all bytes between FF09 header and checksum

### Observed Total Sizes
- **Official app TX**: 43 bytes total
  - FF09 header: 2 bytes
  - Length: 2 bytes
  - Command header: 5 bytes (03 00 4F 02 07)
  - Ciphertext: **32 bytes** (2 AES-128-CBC blocks = 17-32 bytes plaintext)
  - XOR checksum: 1 byte
  - = 2 + 2 + 5 + 32 + 1 = 42 bytes (off by one due to length field encoding)

- **Our implementation TX**: 26 bytes total
  - Ciphertext: **16 bytes** (1 AES block = 1-16 bytes plaintext)

### Key Observation
The official app sends **32 bytes of ciphertext** (2 AES blocks) while our implementation sends only **16 bytes** (1 AES block). This means the plaintext payload in the official app is 17-32 bytes, while ours is 1-16 bytes. The device ACKs our command but does not execute the port switch, suggesting the payload content/encoding is incorrect or incomplete.

## Ciphertext Byte Patterns (Encrypted - Cannot Decode Without Session Key)

Since each BLE session uses a unique ECDH-negotiated AES key, the ciphertext from the official app's session cannot be decrypted with our session key. However, byte pattern analysis across the 6 commands shows systematic variation consistent with port index and on/off state changes:

- Frames for the same port (e.g., 1440/1447 for C1) share some ciphertext prefix similarity
- ON vs OFF for the same port shows differences in specific ciphertext positions (expected from AES-CBC with different plaintext)
- Different ports show broader ciphertext divergence

## Known TLV Parameters (from RN Bundle + Response Analysis)

From the React Native bundle (`index.charging.bundle`) and device response parsing:

| Parameter | TLV Type | Description | Values |
|-----------|----------|-------------|--------|
| Action ID | `0xA1`   | Command identifier | `0x31` for port switch |
| switchIndex | `0xA2` | Port index (DevicePort enum) | C1=0, C2=1, A=2, Pin=3, C3=4, C4=5 |
| switchOn  | `0xA3`   | On/off state (TURN_ON_OFF enum) | OFF=0, ON=1 |
| Unknown   | `0xA4`   | Present in some responses | Unknown purpose |

### Device Response Echo
When the device receives our command, it echoes back:
```
A1=0x31  A2=0x00  A3=0x00
```
This confirms it receives and decrypts the command, but does not execute the port switch. The response includes full telemetry showing the port remains active.

## Status / Telemetry Commands

The charger responds to these encrypted status polling commands (GROUP_STATUS = `0x11`):

| Command | Purpose |
|---------|---------|
| `0x0200` | Port power/voltage/current telemetry |
| `0x020a` | Extended port data |
| `0x0300` | Device info / temperature |

## Open Questions

1. **Plaintext encoding**: The exact encoding of TLV values for the port switch command is unknown. Our current encoding produces too-small ciphertext. Possibilities:
   - Protobuf wire format (app uses `package:protobuf/protobuf.dart`)
   - Additional TLV fields beyond A1-A3
   - Different value encoding (uint16, padding, etc.)

2. **A4 field**: Purpose and required value unknown. May be needed for the command to execute.

3. **Command transformer**: The app has `assemble_command_util.dart` and `command_transformer.dart` which may add framing or fields before encryption.

## RN Bundle References

Key functions from `apk_reversing/rn_bundle_3.17.0/index.charging.bundle`:
- `setDCPortSwitch(params)` - SDK method (module ~713)
- `action_set_dc_port_switch` - Action ID string
- `DevicePort` enum: `{C1:0, C2:1, A:2, Pin:3, C3:4, C4:5}`
- `TURN_ON_OFF` enum: `{OFF:0, ON:1}`
- `setDCPortSwitchParams` - Native Dart function (from libapp.so at offset ~11928268)

## libapp.so Symbol References

From string extraction of `apk_reversing/split_armv7_3.17.0/lib/armeabi-v7a/libapp.so`:
- `setDCPortSwitchParams` - Parameter builder
- `switchIndex` - Port index parameter name
- `switchOn` - On/off parameter name
- `, switchOn: ` and `, switchOn=` - Debug print format strings
- `AKIotA2687Command` - A2687 command module class
- `package:charging/ak_iot_kit/business/A2687/command/a2687_command.dart` - Source path
