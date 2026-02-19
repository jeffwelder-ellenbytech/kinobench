# ATK XTool BLE GATT Reverse Engineering Playbook

## Objective
Determine the exact BLE GATT interface used by `atk-xtool.apk` so a website can control/read the device through Web Bluetooth:
- Service UUID(s)
- Write characteristic UUID(s)
- Notify/read characteristic UUID(s)
- Write type (with response vs without response)
- Notification enable procedure (CCCD)
- Packet framing and checksum behavior

Target protocol correlation:
- Commands: `AF 07 03 ... [CRC]`
- Responses: `DF 07 03 ... [CRC]`
- CRC: `crc = (256 - (sum(data) % 256)) & 0xFF`

## Preconditions
- Physical device available (EL15/DM40 family).
- Android phone with ATK app installed and able to connect to the device.
- Development machine with:
  - `adb`
  - `jadx`
  - `apktool`
  - optional: `Wireshark`, `btmon`, `nRF Connect`
- Browser target for final integration: Chrome/Edge with Web Bluetooth enabled.

## Tooling
Primary:
- `jadx`: decompile Java/Kotlin wrappers and discover BLE-related symbol names.
- `apktool`: decode resources/manifest and inspect APK internals.
- `adb`: collect Bluetooth HCI snoop logs from Android.
- `Wireshark`: decode ATT/GATT packets from btsnoop.

Optional:
- `nRF Connect` (Android): quick interactive service/characteristic inspection.
- `btmon` (Linux): host-side BLE observation if needed.

## Workspace Setup
From repo root:

```bash
mkdir -p /tmp/atk_xtool_jadx /tmp/atk_xtool_apktool
jadx -d /tmp/atk_xtool_jadx alientek_apk/atk-xtool.apk
apktool d -f -o /tmp/atk_xtool_apktool alientek_apk/atk-xtool.apk
```

Quick sanity checks:

```bash
rg -n "BluetoothGatt|GattCallback|Plugin.BLE" /tmp/atk_xtool_jadx/sources | head
rg -n "BLUETOOTH_SCAN|BLUETOOTH_CONNECT" /tmp/atk_xtool_apktool/AndroidManifest.xml
```

Expected signal:
- BLE/GATT callbacks present.
- Android BLE runtime permissions present.

## Phase 1: Static APK Analysis
Goal: extract candidate UUIDs and BLE interaction points before traffic capture.

1. Find BLE API entrypoints and wrappers.

```bash
rg -n "BluetoothGatt|Characteristic|Service|Descriptor|Notify|Write" /tmp/atk_xtool_jadx/sources | head -n 200
```

2. Search for UUID constants and protocol hints.

```bash
rg -n -i "uuid|service|characteristic|notify|write|el15|dm40|af 07 03|df 07 03" /tmp/atk_xtool_jadx/sources /tmp/atk_xtool_apktool | head -n 300
strings /tmp/atk_xtool_apktool/lib/arm64-v8a/libassemblies.arm64-v8a.blob.so | rg -n -i "uuid|Plugin.BLE|Android.Bluetooth.LE|EL15|DM40|notify|write" | head -n 300
```

3. Record all UUID candidates in the inventory table below.

4. Note any evidence of packet framing:
- fixed headers (`AF`, `DF`)
- fixed lengths (`28 bytes` status example)
- checksum usage

Output of this phase:
- initial UUID candidate list
- initial hypothesis for write/notify characteristic roles
- command/response payload hypotheses

## Phase 2: Dynamic BLE Capture on Android
Goal: capture authoritative GATT traffic while using official app actions.

1. Enable HCI snoop logging on Android:
- Developer options -> Enable Bluetooth HCI snoop log.

2. Reproduce key actions in ATK app while connected:
- Connect to device.
- Query status.
- Change mode.
- Set current setpoint.
- Toggle load OFF/ON.
- Read/rename device name (if exposed).

3. Pull logs.

Option A (common):
```bash
adb bugreport /tmp/atk_bugreport.zip
```
Extract `btsnoop_hci.log` from the bugreport archive.

Option B (device-dependent path):
```bash
adb pull /sdcard/btsnoop_hci.log /tmp/btsnoop_hci.log
```

4. Open log in Wireshark:
- Filter: `btatt || bthci_evt || bthci_cmd`
- Focus on:
  - `ATT Write Request` / `ATT Write Command`
  - `ATT Handle Value Notification`
  - `Read By Type Response` and service discovery

Output of this phase:
- exact handle-level write/notify sequence
- extracted raw payload bytes for each user action

## Phase 3: Correlate GATT Traffic to Packet Protocol
Goal: map raw ATT payloads to known `AF/DF` command protocol.

1. For each write packet:
- Copy value bytes.
- Check if payload starts with `AF`.
- Verify checksum using:

```python
def crc8_complement(data: bytes) -> int:
    return (256 - (sum(data) % 256)) & 0xFF
```

2. For each notification/read response:
- Check for `DF` header.
- Validate CRC.
- Parse fields using little-endian layout:
  - voltage: bytes 7..10 (`<f`)
  - current: bytes 11..14 (`<f`)
  - runtime: bytes 15..18 (`<i`)
  - temp: bytes 19..22 (`<f`)
  - setpoint: bytes 23..26 (`<f`)

3. Build one row per command in the command mapping table.

4. Confirm mode/fan/run bytes:
- mode: lower nibble of byte 5
- fan: upper nibble of byte 5
- run: byte 6

Output of this phase:
- verified packet map from GATT writes/notifications to functional commands

## Phase 4: Build Web Bluetooth Mapping
Goal: convert findings into browser-usable interface contract.

1. Define final identifiers:
- `serviceUuid`
- `writeCharUuid`
- `notifyCharUuid`
- `cccd` requirement (if notify)

2. Determine write semantics:
- Write with response (`writeValueWithResponse`) or without (`writeValueWithoutResponse`).
- Required inter-command delay (if any).

3. Define browser flow:
1. `navigator.bluetooth.requestDevice(...)`
2. `device.gatt.connect()`
3. `getPrimaryService(serviceUuid)`
4. `getCharacteristic(writeCharUuid)` and `getCharacteristic(notifyCharUuid)`
5. `startNotifications()` on notify characteristic
6. send command frames and parse notifications

4. Lock in packet encoder/decoder contracts:
- `encodeCommand(commandId, payloadBytes) -> Uint8Array`
- `decodeStatusPacket(bytes) -> parsed object`
- strict CRC validation for inbound/outbound frames

Output of this phase:
- production-ready BLE map and JS interface contract

## Data Tables (fill-in templates)
### Service/Characteristic Inventory
| Service UUID | Characteristic UUID | Properties | Notify CCCD? | Evidence Source | Notes |
|---|---|---|---|---|---|
| | | | | static/dynamic | |
| | | | | static/dynamic | |

### Command Mapping
| Action | Outbound Payload Hex | Write Char UUID | Inbound Payload Hex | Notify/Read Char UUID | Response Len | CRC Pass? | Notes |
|---|---|---|---|---|---:|---|---|
| Query status | | | | | | | |
| Load ON | | | | | | | |
| Load OFF | | | | | | | |
| Set current | | | | | | | |
| Set mode | | | | | | | |
| Name read/set | | | | | | | |

### State/Mode Mapping
| Byte/Field | Raw Value | Meaning | Confidence | Evidence |
|---|---:|---|---|---|
| mode (byte5 low nibble) | 0x01 | CC | high | protocol correlation |
| mode (byte5 low nibble) | 0x09 | CV | high | protocol correlation |
| run (byte6) | | | medium | dynamic |
| fan (byte5 high nibble) | | | low/medium | dynamic |

### Validation Runs
| Test ID | Input Command | Expected Device Behavior | Observed | Pass/Fail | Notes |
|---|---|---|---|---|---|
| V1 | Query | 28-byte status response | | | |
| V2 | Set mode CC | Mode updates to CC | | | |
| V3 | Set current 1.234A | Setpoint reflects 1.234 | | | |
| V4 | Load ON/OFF | Run bit toggles | | | |
| V5 | Bad CRC frame | Rejected/ignored | | | |

## Validation Checklist
- [ ] Service UUID confirmed from dynamic capture.
- [ ] Write characteristic UUID confirmed.
- [ ] Notify/read characteristic UUID confirmed.
- [ ] Notify subscription sequence confirmed (CCCD write if required).
- [ ] CRC rule validated against real traffic.
- [ ] Query/status decode validated against multiple samples.
- [ ] Mode/load/setpoint commands validated against observed behavior.
- [ ] Web Bluetooth smoke test works with discovered UUIDs.

## Known Risks and Fallbacks
- UUIDs may be hidden/obfuscated in static output.
  - Fallback: trust dynamic HCI capture as source of truth.
- Multiple similar characteristics may exist.
  - Fallback: correlate by payload shape (`AF/DF`) and action timing.
- Device firmware variants may use different UUIDs.
  - Fallback: keep mapping table per model/firmware revision.
- Notification packet fragmentation may occur.
  - Fallback: implement frame reassembly by header/length/CRC.

## Next Implementation Artifacts
After table data is filled in, create:
- `alientek_apk/webbluetooth-gatt-map.json`
  - final UUIDs and capability flags.
- `alientek_apk/webbluetooth-protocol-notes.md`
  - finalized command/reference sheet.
- `alientek_apk/web-demo.js` (or app integration module)
  - `connect()`, `sendCommand()`, `decodeStatusPacket()`.

