# Anker A2687 BLE Encryption Handshake

Reverse-engineered protocol documentation for the Anker 160W Prime Charger (A2687) Bluetooth Low Energy communication.

## BLE Characteristics

| Role | UUID |
|------|------|
| **Service** | `8c850001-0302-41c5-b46e-cf057c562025` |
| **Write (TX)** | `8c850002-0302-41c5-b46e-cf057c562025` |
| **Notify (RX)** | `8c850003-0302-41c5-b46e-cf057c562025` |

The device advertises service UUIDs `0x8c85` and `0xff09`.

---

## Frame Structure

Every packet follows the FF09 framing format:

```
[FF][09] [LEN_LO][LEN_HI] [03][00][GROUP][CMD_HI][CMD_LO] [PAYLOAD] [XOR_CHK]
```

| Offset | Size | Description |
|--------|------|-------------|
| 0–1 | 2 | Frame header: always `0xFF 0x09` |
| 2–3 | 2 | Payload length (little-endian uint16, everything after this field minus checksum) |
| 4–5 | 2 | Command header constant: `0x03 0x00` |
| 6 | 1 | Group byte (`0x01` = handshake, `0x0F` = action, `0x11` = status) |
| 7 | 1 | Command high byte (includes flag bits) |
| 8 | 1 | Command low byte |
| 9… | N | TLV payload (plaintext or ciphertext) |
| last | 1 | XOR checksum of bytes 4 through end-of-payload |

### Command High-Byte Flags

| Flag | Value | Meaning |
|------|-------|---------|
| `ENCRYPTED` | `0x40` | Payload is AES-128-CBC ciphertext |
| `ACK` | `0x08` | This frame is an acknowledgment |

---

## TLV Encoding

All plaintext payloads use Type-Length-Value encoding:

```
[TYPE:1] [LENGTH:1] [VALUE:N]  [TYPE:1] [LENGTH:1] [VALUE:N]  …
```

Common TLV tags:

| Tag | Usage |
|-----|-------|
| `0xA1` | UTC timestamp (4 bytes LE) or session key (16 bytes) |
| `0xA2` | Static key material |
| `0xA3` | Capability/config flags, or firmware version (in info response) |
| `0xA4` | Device flags, or **serial number** (in info response) |
| `0xA5` | ECDH data / port config / MAC address |

---

## Static Key Material

A hardcoded hex string (`A2_STATIC_HEX`) is sent during every handshake step:

```
32633337376466613039636462373932343838396534323932613337663631633863356564353264
```

Decoded to ASCII: `2c377dfa09cdb7924889e4292a37f61c8c5ed52d`

The **first 16 bytes** of this decoded value serve as the **initial AES key** used to bootstrap encryption before a session key is established:

```
Initial Key = 2c 37 7d fa 09 cd b7 92 48 89 e4 29 2a 37 f6 1c
```

---

## Handshake Sequence

The full handshake consists of four unencrypted setup commands, a local crypto initialization step, and one encrypted key-exchange round-trip.

### Step 1 — Hello (`0x0001`)

```
Group:   0x01 (HANDSHAKE)
Command: 0x0001
TLV:
  A1 = current UTC timestamp (4 bytes LE)
  A2 = A2_STATIC_HEX (40 bytes)
```

Sent unencrypted. The device ACKs. This announces the client and synchronizes the clock.

### Step 2 — Capability Exchange (`0x0003`)

```
Group:   0x01 (HANDSHAKE)
Command: 0x0003
TLV:
  A1 = UTC timestamp
  A2 = A2_STATIC_HEX
  A3 = 0x20 (capability flags)
  A4 = 0x00F0 (additional flags, 2 bytes LE)
```

Sent unencrypted. The device ACKs. This negotiates which protocol features are supported.

### Step 3 — Device Info Request (`0x0029`)

```
Group:   0x01 (HANDSHAKE)
Command: 0x0029
TLV:
  A1 = UTC timestamp
  A2 = A2_STATIC_HEX
```

Sent unencrypted. The device responds with:

```
Response TLV:
  A3 = firmware version (ASCII string)
  A4 = serial number (ASCII string)  ← used for IV derivation
  A5 = MAC address (6 bytes)
```

The **serial number** from `A4` is critical — it becomes the AES initialization vector.

### Step 4 — Encryption Setup (`0x0005`)

```
Group:   0x01 (HANDSHAKE)
Command: 0x0005
TLV:
  A1 = UTC timestamp
  A2 = A2_STATIC_HEX
  A3 = 0x20
  A4 = 0x00F0
  A5 = 0x02
```

Sent unencrypted. The device ACKs. This signals the client is ready to transition to encrypted mode.

### Step 5 — Initialize Crypto (local)

No packet is sent. The client derives the IV from the serial number obtained in Step 3:

```typescript
function normalizeIvFromSerial(serial: string): Uint8Array {
  const serialBytes = new TextEncoder().encode(serial)
  const iv = new Uint8Array(16)  // zero-filled
  if (serialBytes.length > 16) {
    iv.set(serialBytes.slice(0, 16), 0)
  } else {
    iv.set(serialBytes, 0)       // right-padded with 0x00
  }
  return iv
}
```

The crypto context is now:

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-128-CBC |
| Key | Initial key (first 16 bytes of decoded A2_STATIC_HEX) |
| IV | Serial number UTF-8 bytes, zero-padded to 16 bytes |
| Padding | PKCS#7 |

State transitions to **`Initial`**.

### Step 6 — Request Session Key (`0x0022`, encrypted)

```
Group:   0x01 (HANDSHAKE)
Command: 0x0022 | 0x40 (encrypted flag set)
TLV (plaintext, then AES-encrypted):
  A1 = UTC timestamp
  A2 = A2_STATIC_HEX
  A3 = 4 zero bytes
  A5 = 40 zero bytes
```

The TLV payload is encrypted with AES-128-CBC using the **initial key** and **serial-derived IV**, then placed in the frame with the `0x40` encrypted flag on the command byte.

### Step 7 — Receive Session Key (`0x0022` response, encrypted)

The device responds with an encrypted frame. The client:

1. Strips the frame header and checksum
2. Extracts ciphertext starting at offset 5 (after command header), trying offset 6 as a fallback
3. Decrypts with AES-128-CBC using the initial key and serial IV
4. Parses the decrypted TLV
5. Extracts the **16-byte session key** from the `A1` tag

The crypto context is now upgraded:

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-128-CBC |
| Key | **Session key** (16 bytes, device-generated random) |
| IV | Same serial-derived IV |
| Padding | PKCS#7 |

State transitions to **`Session`**. All subsequent communication uses the session key.

---

## Encrypted Session Communication

With the session key established, all status queries and control commands are encrypted.

### Status Query Example (`0x0200`)

```
Group:   0x11 (STATUS)
Command: 0x0200 | 0x40
TLV (encrypted with session key):
  A1 = 0x21 (query flag)
```

### Port Toggle Example (`0x0207`)

```
Group:   0x0F (ACTION)
Command: 0x0207 | 0x40
TLV (encrypted with session key):
  A1 = 0x31 (action ID: port_switch)
  A2 = [0x02, portIndex, 0x00] (uint16 LE)
  A3 = [0x02, onOff, 0x00]    (uint16 LE: 0=off, 1=on)
  A4 = [0x01, 0x00]           (status field)
```

---

## State Machine

```
     INACTIVE
        │
        ▼
   ┌─ CONNECT ──────────────────────────────┐
   │  Load BLE characteristics               │
   │                                          │
   │  0x0001  Hello          (unencrypted)    │
   │  0x0003  Capabilities   (unencrypted)    │
   │  0x0029  Device Info    (unencrypted)    │
   │          ↳ extract serial number         │
   │  0x0005  Encryption Setup (unencrypted)  │
   │                                          │
   │  ── derive IV from serial ──             │
   │  ── import initial AES key ──            │
   │          State: INITIAL                  │
   │                                          │
   │  0x0022  Session Key Req (encrypted)     │
   │  0x0022  Session Key Rsp (encrypted)     │
   │          ↳ extract 16-byte session key   │
   │          ↳ import session AES key        │
   │          State: SESSION                  │
   │                                          │
   │  0x0200  Status polls   (encrypted)      │
   │  0x0207  Port control   (encrypted)      │
   │  …                                       │
   └──────────────── DISCONNECT ──────────────┘
```

---

## Solix ECDH Fallback

If the FF09 handshake fails (e.g. newer firmware variant), the code falls back to an ECDH-based key negotiation:

| Parameter | Value |
|-----------|-------|
| Curve | P-256 (secp256r1) |
| Client Private Key | `7dfbea61cd95cee49c458ad7419e817f1ade9a66136de3c7d5787af1458e39f4` (hardcoded) |
| Shared Secret | First 16 bytes of the ECDH result |
| IV | All zeros (16 bytes) |
| Algorithm | AES-128-CBC |

The flow sends 5 pre-computed negotiation packets. The device responds with its P-256 public key (64 bytes, uncompressed X‖Y). The client computes the ECDH shared secret and uses the first 16 bytes as the AES key for decrypting telemetry.

---

## Crypto Summary

| Phase | AES Key | IV | Key Source |
|-------|---------|----|------------|
| Handshake (Initial) | `A2_STATIC_HEX[0:16]` | Serial (zero-padded) | Hardcoded constant + device info response |
| Session (FF09) | Device-generated random (16B) | Serial (zero-padded) | Encrypted `0x0022` response |
| Solix Telemetry | ECDH shared secret (first 16B) | All zeros | P-256 key agreement |

---

## Known Issues

- The official Anker app sends 32 bytes (2 AES blocks) for port-switch commands; the current implementation sends only 16 bytes (1 block). The device ACKs but doesn't execute, suggesting the plaintext payload encoding differs from what has been captured so far.
- There may be undocumented TLV fields, protobuf wrapping, or additional padding in the official app's payloads.
