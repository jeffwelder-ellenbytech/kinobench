// Anker Prime Battery Pack BLE Protocol Service
// Based on atc1441's reverse engineering: https://atc1441.github.io/AnkerPrimeWebBle.html

export type CryptoState = 'INACTIVE' | 'Initial' | 'Session'

export interface AnkerDeviceInfo {
  mac: string
  serial: string
  firmware: string
}

export interface AnkerPortData {
  mode: 'Off' | 'Input' | 'Output'
  voltage: number
  current: number
  power: number
}

export interface AnkerPowerStatus {
  batteryPercent: number
  temperature: number
  totalInputW: number
  totalOutputW: number
  usbC1: AnkerPortData
  usbC2: AnkerPortData
  usbA: AnkerPortData
}

export interface AnkerBleCallbacks {
  onConnectionChange?: (connected: boolean) => void
  onDeviceInfo?: (info: AnkerDeviceInfo) => void
  onPowerStatus?: (status: AnkerPowerStatus) => void
  onCryptoStateChange?: (state: CryptoState) => void
  onError?: (error: string) => void
  onLog?: (message: string) => void
}

const ADVERTISED_SERVICE_UUID = 0x2215
const FULL_SERVICE_UUID = '22150001-4002-81c5-b46e-cf057c562025'
const WRITE_CHARACTERISTIC_UUID = '22150002-4002-81c5-b46e-cf057c562025'
const NOTIFY_CHARACTERISTIC_UUID = '22150003-4002-81c5-b46e-cf057c562025'

const A2_STATIC_HEX = '32633337376466613039636462373932343838396534323932613337663631633863356564353264'
const FRAME_HEADER_1 = 0xff
const FRAME_HEADER_2 = 0x09
const COMMAND_HEADER_1 = 0x03
const COMMAND_HEADER_2 = 0x00
const COMMAND_FLAG_ENCRYPTED = 0x40
const COMMAND_FLAG_ACK = 0x08
const COMMAND_ACK_MASK_16 = 0x0800

const GROUP_HANDSHAKE = 0x01
const GROUP_STATUS = 0x11
const CMD_HANDSHAKE_1 = 0x0001
const CMD_HANDSHAKE_2 = 0x0003
const CMD_HANDSHAKE_INFO = 0x0029
const CMD_HANDSHAKE_4 = 0x0005
const CMD_SESSION_KEY = 0x0022
const CMD_STATUS_FULL = 0x0500
const CMD_STATUS_ALT_FULL = 0x0d00
const CMD_STATUS_LIVE = 0x050e

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function toHexString(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

function xorChecksum(data: Uint8Array): number {
  let cs = 0
  for (let i = 0; i < data.length; i++) cs ^= data[i]!
  return cs
}

function buildTlvBuffer(tlvArray: { type: number; value: Uint8Array }[]): Uint8Array {
  let totalLength = 0
  for (const item of tlvArray) totalLength += 2 + item.value.length
  const buffer = new Uint8Array(totalLength)
  let offset = 0
  for (const item of tlvArray) {
    buffer[offset++] = item.type
    buffer[offset++] = item.value.length
    buffer.set(item.value, offset)
    offset += item.value.length
  }
  return buffer
}

function buildRequestContent(
  command: number,
  tlvArray: { type: number; value: Uint8Array }[],
  group: number = GROUP_HANDSHAKE,
): Uint8Array {
  const commandHigh = (command >> 8) & 0xff
  const commandLow = command & 0xff
  const commandHeader = new Uint8Array([COMMAND_HEADER_1, COMMAND_HEADER_2, group, commandHigh])
  const commandCode = new Uint8Array([commandLow])
  const tlvData = buildTlvBuffer(tlvArray)
  const payload = new Uint8Array(commandHeader.length + commandCode.length + tlvData.length)
  payload.set(commandHeader, 0)
  payload.set(commandCode, commandHeader.length)
  payload.set(tlvData, commandHeader.length + commandCode.length)
  return payload
}

function framePacket(payload: Uint8Array): Uint8Array {
  const totalPacketLength = payload.length + 5
  const messageForChecksum = new Uint8Array(4 + payload.length)
  const view = new DataView(messageForChecksum.buffer as ArrayBuffer)
  view.setUint8(0, FRAME_HEADER_1)
  view.setUint8(1, FRAME_HEADER_2)
  view.setUint16(2, totalPacketLength, true)
  messageForChecksum.set(payload, 4)
  const checksum = xorChecksum(messageForChecksum)
  const finalMessage = new Uint8Array(totalPacketLength)
  finalMessage.set(messageForChecksum, 0)
  finalMessage[totalPacketLength - 1] = checksum
  return finalMessage
}

function parseTlv(data: Uint8Array): Map<number, Uint8Array> {
  const map = new Map<number, Uint8Array>()
  let offset = 0
  while (offset + 1 < data.length) {
    const type = data[offset]!
    const len = data[offset + 1]!
    if (offset + 2 + len > data.length) break
    map.set(type, data.slice(offset + 2, offset + 2 + len))
    offset += 2 + len
  }
  return map
}

function parseDecryptedTlv(data: Uint8Array): Map<number, Uint8Array> {
  const offset = data.length > 0 && data[0] === 0x00 ? 1 : 0
  return parseTlv(data.slice(offset))
}

function describeTlvArray(tlvArray: { type: number; value: Uint8Array }[]): string {
  return tlvArray
    .map(({ type, value }) => `0x${type.toString(16).toUpperCase().padStart(2, '0')}(${value.length})`)
    .join(', ')
}

function getModeString(mode: number): 'Off' | 'Input' | 'Output' {
  if (mode === 1) return 'Input'
  if (mode === 2) return 'Output'
  return 'Off'
}

function parsePortData(value: Uint8Array): AnkerPortData {
  if (value.length < 7) return { mode: 'Off', voltage: 0, current: 0, power: 0 }
  const view = new DataView(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
  const mode = getModeString(value[2]!)
  const voltage = view.getUint16(3, true) / 10
  const current = view.getUint16(5, true) / 10
  return { mode, voltage, current, power: Math.round(voltage * current * 10) / 10 }
}

function emptyPortData(): AnkerPortData {
  return { mode: 'Off', voltage: 0, current: 0, power: 0 }
}

function emptyPowerStatus(): AnkerPowerStatus {
  return {
    batteryPercent: 0,
    temperature: 0,
    totalInputW: 0,
    totalOutputW: 0,
    usbC1: emptyPortData(),
    usbC2: emptyPortData(),
    usbA: emptyPortData(),
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function parseBatteryPercent(value: Uint8Array): number | null {
  if (value.length < 10) return null
  const whole = value[8] ?? 0
  const fractional = (value[9] ?? 0) / 100
  return clampPercent(Math.round((whole + fractional) * 100) / 100)
}

function clonePowerStatus(status: AnkerPowerStatus): AnkerPowerStatus {
  return {
    batteryPercent: status.batteryPercent,
    temperature: status.temperature,
    totalInputW: status.totalInputW,
    totalOutputW: status.totalOutputW,
    usbC1: { ...status.usbC1 },
    usbC2: { ...status.usbC2 },
    usbA: { ...status.usbA },
  }
}

export class AnkerBleService {
  private device: BluetoothDevice | null = null
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null
  private cryptoState: CryptoState = 'INACTIVE'
  private activeKey: CryptoKey | null = null
  private activeIv: Uint8Array | null = null
  private sessionUtcBytes: Uint8Array | null = null
  private serialNumber = ''
  private lastReceivedCommand: number | null = null
  private lastReceivedWasEncrypted = false
  private decryptSuccessCount = 0
  private decryptErrorCount = 0
  private lastPowerStatus: AnkerPowerStatus = emptyPowerStatus()
  // Matches reference: resolveNextNotificationPromise pattern
  private resolveNextNotification: ((data: Uint8Array) => void) | null = null
  private callbacks: AnkerBleCallbacks

  constructor(callbacks: AnkerBleCallbacks = {}) {
    this.callbacks = callbacks
  }

  private log(msg: string): void {
    console.log(`[AnkerBLE] ${msg}`)
    this.callbacks.onLog?.(msg)
  }

  get isConnected(): boolean {
    return this.device?.gatt?.connected ?? false
  }

  get currentCryptoState(): CryptoState {
    return this.cryptoState
  }

  async connect(): Promise<void> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [ADVERTISED_SERVICE_UUID] }],
        optionalServices: [FULL_SERVICE_UUID],
      })

      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect()
      })

      const server = await this.device.gatt!.connect()
      const service = await server.getPrimaryService(FULL_SERVICE_UUID)

      this.writeChar = await service.getCharacteristic(WRITE_CHARACTERISTIC_UUID)
      this.notifyChar = await service.getCharacteristic(NOTIFY_CHARACTERISTIC_UUID)

      const wp = this.writeChar.properties
      this.log(`Write char properties: write=${wp.write} writeWithoutResponse=${wp.writeWithoutResponse}`)
      const np = this.notifyChar.properties
      this.log(`Notify char properties: notify=${np.notify} indicate=${np.indicate}`)

      this.notifyChar.addEventListener('characteristicvaluechanged', (event: Event) => {
        const char = event.target as BluetoothRemoteGATTCharacteristic
        if (char.value) {
          this.handleNotification(new Uint8Array(char.value.buffer as ArrayBuffer))
        }
      })
      await this.notifyChar.startNotifications()

      this.log('BLE connected, waiting for BLE stack to settle...')
      this.callbacks.onConnectionChange?.(true)

      // Small delay to let BLE stack settle before handshake
      await new Promise((r) => setTimeout(r, 500))

      this.log('Starting handshake...')
      // Run handshake
      await this.handshake()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.callbacks.onError?.(msg)
      throw err
    }
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect()
    }
    this.handleDisconnect()
  }

  private handleDisconnect(): void {
    this.device = null
    this.writeChar = null
    this.notifyChar = null
    this.cryptoState = 'INACTIVE'
    this.activeKey = null
    this.activeIv = null
    this.sessionUtcBytes = null
    this.serialNumber = ''
    this.lastReceivedCommand = null
    this.lastReceivedWasEncrypted = false
    this.decryptSuccessCount = 0
    this.decryptErrorCount = 0
    this.lastPowerStatus = emptyPowerStatus()
    this.resolveNextNotification = null
    this.callbacks.onCryptoStateChange?.('INACTIVE')
    this.callbacks.onConnectionChange?.(false)
  }

  /** Send a framed payload (fire-and-forget write) */
  private async sendPayload(payload: Uint8Array): Promise<void> {
    if (!this.writeChar) throw new Error('Not connected')
    const packet = framePacket(payload)
    this.log(`--> SEND (${packet.byteLength} bytes) ${toHexString(packet)}`)
    // Pass Uint8Array directly, matching reference implementation
    await this.writeChar.writeValueWithoutResponse(packet)
  }

  /** Send payload and wait for the next notification response */
  private async sendAndWaitForResponse(payload: Uint8Array, timeoutMs = 10000): Promise<Uint8Array> {
    await this.sendPayload(payload)
    return this.waitForNextNotification(timeoutMs)
  }

  /** Wait for the next notification (matches reference's `await new Promise(r => resolveNextNotificationPromise = r)`) */
  private waitForNextNotification(timeoutMs = 10000): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.resolveNextNotification = null
        reject(new Error('Response timeout'))
      }, timeoutMs)

      this.resolveNextNotification = (data: Uint8Array) => {
        clearTimeout(timeout)
        resolve(data)
      }
    })
  }

  private handleNotification(rawData: Uint8Array): void {
    this.log(`<-- RECV (${rawData.byteLength} bytes) ${toHexString(rawData)}`)

    // Short packet — still resolve pending promise (reference does this)
    if (rawData.byteLength < 5) {
      if (this.resolveNextNotification) {
        const resolve = this.resolveNextNotification
        this.resolveNextNotification = null
        resolve(rawData)
      }
      return
    }

    // Strip 4-byte header + 1-byte checksum to get payload
    const payloadWithHeader = rawData.slice(4, rawData.byteLength - 1)

    // Parse command info from payload
    let contentToParse = payloadWithHeader
    if (payloadWithHeader.length >= 5) {
      const commandHighByte = payloadWithHeader[3]!
      const commandLowByte = payloadWithHeader[4]!
      const isEncrypted = (commandHighByte & COMMAND_FLAG_ENCRYPTED) !== 0
      const isAck = (commandHighByte & COMMAND_FLAG_ACK) !== 0
      const commandHighBase = commandHighByte & ~(COMMAND_FLAG_ENCRYPTED | COMMAND_FLAG_ACK)
      const fullCommand = (commandHighBase << 8) | commandLowByte
      this.lastReceivedCommand = fullCommand
      this.lastReceivedWasEncrypted = isEncrypted

      this.log(
        `    Command: 0x${fullCommand.toString(16).padStart(4, '0')} encrypted=${isEncrypted} ack=${isAck}`,
      )

      if (isEncrypted) {
        if (!this.activeKey) {
          this.log('    No active key for decryption')
        } else {
          // Encrypted responses: ciphertext starts at offset 5 (no status byte)
          const cipherText = payloadWithHeader.slice(5)
          // Decrypt async — resolve promise after decryption completes
          this.decrypt(cipherText)
            .then((decrypted) => {
              this.decryptSuccessCount++
              this.log(`    Decrypted: ${toHexString(decrypted)}`)

              // Process decrypted content
              this.processDecryptedContent(fullCommand, decrypted)

              // Resolve pending promise with decrypted data
              if (this.resolveNextNotification) {
                const resolve = this.resolveNextNotification
                this.resolveNextNotification = null
                resolve(decrypted)
              }
            })
            .catch((err) => {
              this.decryptErrorCount++
              this.log(`    Decryption error: ${err}`)
              // Still resolve promise on error (reference does this)
              if (this.resolveNextNotification) {
                const resolve = this.resolveNextNotification
                this.resolveNextNotification = null
                resolve(rawData)
              }
            })
          return // Don't resolve below — async decrypt handles it
        }
      } else {
        // Unencrypted — process TLV content directly
        // Response header is 6 bytes: [03 00 group cmdHigh cmdLow status] then TLV data
        this.handlePlainResponse(fullCommand, payloadWithHeader.slice(6))
      }
    }

    // Resolve pending promise
    if (this.resolveNextNotification) {
      const resolve = this.resolveNextNotification
      this.resolveNextNotification = null
      resolve(contentToParse)
    }
  }

  private handlePlainResponse(command: number, tlvData: Uint8Array): void {
    const normalizedCommand = command & ~COMMAND_ACK_MASK_16
    const tlv = parseTlv(tlvData)

    // Step 3 response (0x0029): extract device info
    if (normalizedCommand === CMD_HANDSHAKE_INFO) {
      const firmware = tlv.has(0xa3) ? new TextDecoder().decode(tlv.get(0xa3)!) : ''
      const serial = tlv.has(0xa4) ? new TextDecoder().decode(tlv.get(0xa4)!) : ''
      const macBytes = tlv.get(0xa5)
      const mac = macBytes
        ? Array.from(macBytes)
            .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':')
        : ''

      this.serialNumber = serial
      this.log(`    Device: serial=${serial} mac=${mac} fw=${firmware}`)
      this.callbacks.onDeviceInfo?.({ mac, serial, firmware })
    }
  }

  private processDecryptedContent(command: number, decrypted: Uint8Array): void {
    const normalizedCommand = command & ~COMMAND_ACK_MASK_16
    const tlv = parseDecryptedTlv(decrypted)

    // Check for session key delivery (during Initial crypto state)
    if (this.cryptoState === 'Initial' && tlv.has(0xa1)) {
      const keyData = tlv.get(0xa1)!
      if (keyData.length === 16) {
        this.log('    Received session key, upgrading crypto')
        this.setupCrypto(keyData, this.activeIv!, 'Session')
        return
      }
    }

    // Status response
    if (normalizedCommand === CMD_STATUS_FULL || normalizedCommand === CMD_STATUS_ALT_FULL) {
      this.parseComprehensiveStatus(tlv)
    } else if (normalizedCommand === CMD_STATUS_LIVE) {
      this.parseLivePowerStatus(tlv)
    }
  }

  private parseComprehensiveStatus(tlv: Map<number, Uint8Array>): void {
    const status = emptyPowerStatus()

    const batteryData = tlv.get(0xa2)
    if (batteryData) {
      const batteryPercent = parseBatteryPercent(batteryData)
      if (batteryPercent !== null) status.batteryPercent = batteryPercent
    }

    const tempData = tlv.get(0xb3)
    if (tempData && tempData.length > 1) {
      status.temperature = tempData[1] ?? 0
    }

    const totals = tlv.get(0xae)
    if (totals && totals.length >= 5) {
      const view = new DataView(totals.buffer as ArrayBuffer, totals.byteOffset, totals.byteLength)
      status.totalOutputW = view.getUint16(1, true) / 10
      status.totalInputW = view.getUint16(3, true) / 10
    }

    if (tlv.has(0xa4)) status.usbC1 = parsePortData(tlv.get(0xa4)!)
    if (tlv.has(0xa5)) status.usbC2 = parsePortData(tlv.get(0xa5)!)
    if (tlv.has(0xa6)) status.usbA = parsePortData(tlv.get(0xa6)!)

    this.lastPowerStatus = status
    this.log(`    Status: ${status.batteryPercent}% ${status.temperature}°C out=${status.totalOutputW}W in=${status.totalInputW}W`)
    this.callbacks.onPowerStatus?.(status)
  }

  private parseLivePowerStatus(tlv: Map<number, Uint8Array>): void {
    // 0x050E uses a different TLV schema than 0x0500 (matches reference mapping).
    const status = clonePowerStatus(this.lastPowerStatus)

    if (tlv.has(0xa2)) status.usbC1 = parsePortData(tlv.get(0xa2)!)
    if (tlv.has(0xa3)) status.usbC2 = parsePortData(tlv.get(0xa3)!)
    if (tlv.has(0xa4)) status.usbA = parsePortData(tlv.get(0xa4)!)

    const totals = tlv.get(0xa6)
    if (totals && totals.length >= 5) {
      const view = new DataView(totals.buffer as ArrayBuffer, totals.byteOffset, totals.byteLength)
      status.totalOutputW = view.getUint16(1, true) / 10
      status.totalInputW = view.getUint16(3, true) / 10
    }

    const batteryData = tlv.get(0xa8)
    if (batteryData) {
      const batteryPercent = parseBatteryPercent(batteryData)
      if (batteryPercent !== null) status.batteryPercent = batteryPercent
    }

    this.lastPowerStatus = status
    this.log(
      `    Live Status: ${status.batteryPercent}% ${status.temperature}°C out=${status.totalOutputW}W in=${status.totalInputW}W`,
    )
    this.callbacks.onPowerStatus?.(status)
  }

  private async handshake(): Promise<void> {
    const utcSeconds = Math.floor(Date.now() / 1000)
    this.sessionUtcBytes = new Uint8Array(4)
    new DataView(this.sessionUtcBytes.buffer as ArrayBuffer).setUint32(0, utcSeconds, true)

    const a2Value = hexToBytes(A2_STATIC_HEX)

    // Step 1: Command 0x0001
    this.log('Handshake step 1: 0x0001')
    await this.sendAndWaitForResponse(
      buildRequestContent(CMD_HANDSHAKE_1, [
        { type: 0xa1, value: this.sessionUtcBytes },
        { type: 0xa2, value: a2Value },
      ]),
    )

    // Step 2: Command 0x0003
    this.log('Handshake step 2: 0x0003')
    await this.sendAndWaitForResponse(
      buildRequestContent(CMD_HANDSHAKE_2, [
        { type: 0xa1, value: this.sessionUtcBytes },
        { type: 0xa2, value: a2Value },
        { type: 0xa3, value: new Uint8Array([0x20]) },
        { type: 0xa4, value: new Uint8Array([0x00, 0xf0]) },
      ]),
    )

    // Step 3: Command 0x0029 (device info — serial extracted in handlePlainResponse)
    this.log('Handshake step 3: 0x0029')
    await this.sendAndWaitForResponse(
      buildRequestContent(CMD_HANDSHAKE_INFO, [
        { type: 0xa1, value: this.sessionUtcBytes },
        { type: 0xa2, value: a2Value },
      ]),
    )

    if (!this.serialNumber) {
      throw new Error('Serial number not extracted from handshake')
    }

    // Step 4: Command 0x0005
    this.log('Handshake step 4: 0x0005')
    await this.sendAndWaitForResponse(
      buildRequestContent(CMD_HANDSHAKE_4, [
        { type: 0xa1, value: this.sessionUtcBytes },
        { type: 0xa2, value: a2Value },
        { type: 0xa3, value: new Uint8Array([0x20]) },
        { type: 0xa4, value: new Uint8Array([0x00, 0xf0]) },
        { type: 0xa5, value: new Uint8Array([0x02]) },
      ]),
    )

    this.log('Unencrypted handshake complete, setting up crypto...')

    // Setup initial encryption
    const initialKey = hexToBytes(A2_STATIC_HEX.substring(0, 32))
    const iv = new TextEncoder().encode(this.serialNumber)
    this.log(`Initial key (${initialKey.length} bytes): ${toHexString(initialKey)}`)
    this.log(`IV from serial "${this.serialNumber}" (${iv.length} bytes): ${toHexString(iv)}`)
    await this.setupCrypto(initialKey, iv, 'Initial')

    const sessionKeyTlvs = [
      { type: 0xa1, value: this.sessionUtcBytes },
      { type: 0xa2, value: a2Value },
      { type: 0xa3, value: new Uint8Array(4) },
      { type: 0xa5, value: new Uint8Array(40) },
    ]

    // Send encrypted command 0x0022 to get session key.
    this.log('Requesting session key (0x0022)...')
    this.log(`Session-key request TLVs: ${describeTlvArray(sessionKeyTlvs)}`)
    await this.sendEncrypted(GROUP_HANDSHAKE, CMD_SESSION_KEY, sessionKeyTlvs)

    // Wait for session key to arrive asynchronously via notification handler.
    this.log('Waiting for session key response...')
    await this.waitForCryptoState('Session', 10000)
    this.log('Session key established')

    // Request initial status after session key is active.
    this.log('Requesting initial status...')
    await this.requestStatus()
  }

  private async waitForCryptoState(target: CryptoState, timeoutMs = 10000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (this.cryptoState === target) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const lastCommand =
      this.lastReceivedCommand === null ? 'none' : `0x${this.lastReceivedCommand.toString(16).padStart(4, '0')}`
    throw new Error(
      `Timed out waiting for crypto state "${target}". Current="${this.cryptoState}", lastCommand=${lastCommand}, lastEncrypted=${this.lastReceivedWasEncrypted}, decryptOk=${this.decryptSuccessCount}, decryptErr=${this.decryptErrorCount}`,
    )
  }

  private async setupCrypto(keyBytes: Uint8Array, ivBytes: Uint8Array, state: CryptoState): Promise<void> {
    // Pass Uint8Array directly to match reference implementation exactly
    this.activeKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as ArrayBuffer,
      { name: 'AES-CBC', length: 128 },
      false,
      ['encrypt', 'decrypt'],
    )
    this.activeIv = ivBytes
    this.cryptoState = state
    this.callbacks.onCryptoStateChange?.(state)
  }

  private async encrypt(plainText: Uint8Array): Promise<Uint8Array> {
    if (!this.activeKey || !this.activeIv) throw new Error('Crypto not initialized')
    // Pass Uint8Array directly (not .buffer) to match reference
    const result = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: this.activeIv as unknown as ArrayBuffer },
      this.activeKey,
      plainText as unknown as ArrayBuffer,
    )
    return new Uint8Array(result)
  }

  private async decrypt(cipherText: Uint8Array): Promise<Uint8Array> {
    if (!this.activeKey || !this.activeIv) throw new Error('Crypto not initialized')
    const result = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: this.activeIv as unknown as ArrayBuffer },
      this.activeKey,
      cipherText as unknown as ArrayBuffer,
    )
    return new Uint8Array(result)
  }

  private buildEncryptedPayload(
    group: number,
    command: number,
    cipherText: Uint8Array,
  ): Uint8Array {
    const commandHigh = ((command >> 8) & 0xff) | COMMAND_FLAG_ENCRYPTED
    const commandLow = command & 0xff
    const header = new Uint8Array([COMMAND_HEADER_1, COMMAND_HEADER_2, group, commandHigh, commandLow])
    const payload = new Uint8Array(header.length + cipherText.length)
    payload.set(header, 0)
    payload.set(cipherText, header.length)
    return payload
  }

  /** Send encrypted command and wait for response */
  private async sendEncryptedAndWait(
    group: number,
    command: number,
    tlvArray: { type: number; value: Uint8Array }[],
  ): Promise<Uint8Array> {
    const tlvData = buildTlvBuffer(tlvArray)
    const cipherText = await this.encrypt(tlvData)
    const payload = this.buildEncryptedPayload(group, command, cipherText)
    return this.sendAndWaitForResponse(payload)
  }

  /** Send encrypted command (fire-and-forget) */
  private async sendEncrypted(
    group: number,
    command: number,
    tlvArray: { type: number; value: Uint8Array }[],
  ): Promise<void> {
    const tlvData = buildTlvBuffer(tlvArray)
    const cipherText = await this.encrypt(tlvData)
    const payload = this.buildEncryptedPayload(group, command, cipherText)
    await this.sendPayload(payload)
  }

  async requestStatus(): Promise<void> {
    if (this.cryptoState !== 'Session') {
      throw new Error(`Session key is not active. Current crypto state: ${this.cryptoState}`)
    }

    await this.sendEncrypted(GROUP_STATUS, CMD_STATUS_FULL, [
      { type: 0xa1, value: new Uint8Array([0x21]) },
    ])
  }
}
