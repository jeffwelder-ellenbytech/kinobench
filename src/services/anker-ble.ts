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

export interface AnkerBleProfile {
  name: string
  advertisedServiceUuids: BluetoothServiceUUID[]
  deviceNamePrefixes?: string[]
  fullServiceUuid: BluetoothServiceUUID
  writeCharacteristicUuid: string
  notifyCharacteristicUuid: string
  statusCommands: number[]
}

export const ANKER_POWERBANK_PROFILE: AnkerBleProfile = {
  name: 'Powerbank',
  advertisedServiceUuids: [0x2215, 0xff09],
  deviceNamePrefixes: ['Anker Prime Power'],
  fullServiceUuid: '22150001-4002-81c5-b46e-cf057c562025',
  writeCharacteristicUuid: '22150002-4002-81c5-b46e-cf057c562025',
  notifyCharacteristicUuid: '22150003-4002-81c5-b46e-cf057c562025',
  statusCommands: [0x0500],
}

export const ANKER_CHARGER_PROFILE: AnkerBleProfile = {
  name: 'Charger',
  advertisedServiceUuids: [0x8c85, 0xff09],
  fullServiceUuid: '8c850001-0302-41c5-b46e-cf057c562025',
  writeCharacteristicUuid: '8c850002-0302-41c5-b46e-cf057c562025',
  notifyCharacteristicUuid: '8c850003-0302-41c5-b46e-cf057c562025',
  // Observed in real A2687 capture as encrypted group 0x11 responses:
  // 0x0200, 0x020a, 0x0300.
  statusCommands: [0x0200, 0x020a, 0x0300],
}

const A2_STATIC_HEX = '32633337376466613039636462373932343838396534323932613337663631633863356564353264'
const FRAME_HEADER_1 = 0xff
const FRAME_HEADER_2 = 0x09
const COMMAND_HEADER_1 = 0x03
const COMMAND_HEADER_2 = 0x00
const COMMAND_FLAG_ENCRYPTED = 0x40
const COMMAND_FLAG_ACK = 0x08
const COMMAND_ACK_MASK_16 = 0x0800

const GROUP_HANDSHAKE = 0x01
const GROUP_ACTION = 0x0f
const GROUP_STATUS = 0x11
const CMD_HANDSHAKE_1 = 0x0001
const CMD_HANDSHAKE_2 = 0x0003
const CMD_HANDSHAKE_INFO = 0x0029
const CMD_HANDSHAKE_4 = 0x0005
const CMD_SESSION_KEY = 0x0022
const CMD_STATUS_FULL = 0x0500
const CMD_STATUS_ALT_FULL = 0x0d00
const CMD_STATUS_LIVE = 0x050e
const CMD_CHARGER_STATUS_FULL = 0x0200
const CMD_CHARGER_STATUS_LIVE = 0x0300
const CMD_CHARGER_STATUS_AUX = 0x020a
const CMD_CHARGER_PORT_SWITCH = 0x0207
const SOLIX_NEGOTIATION_TIMEOUT_MS = 90_000
const SOLIX_NEGOTIATION_RETRY_MS = 3_000
const SOLIX_PRIVATE_KEY_HEX = '7dfbea61cd95cee49c458ad7419e817f1ade9a66136de3c7d5787af1458e39f4'
const SOLIX_NEGOTIATION_COMMAND_0 = 'ff0936000300010001a10442ad8c69a22462326463306231372d623735642d346162662d626136652d656337633939376332336537b9'
const SOLIX_NEGOTIATION_COMMAND_1 = 'ff093d000300010003a10442ad8c69a22462326463306231372d623735642d346162662d626136652d656337633939376332336537a30120a40200f064'
const SOLIX_NEGOTIATION_COMMAND_2 = 'ff0936000300010029a10442ad8c69a22462326463306231372d623735642d346162662d626136652d65633763393937633233653791'
const SOLIX_NEGOTIATION_COMMAND_3 = 'ff0940000300010005a10443ad8c69a22462326463306231372d623735642d346162662d626136652d656337633939376332336537a30120a40200f0a50140fa'
const SOLIX_NEGOTIATION_COMMAND_4 = 'ff094c000300010021a140060ea168f232aedb37fb2d120c49180329ac72ab5ec3eb8fd30a2f252dc5e151dabccd9b1dc1e288704ca760a0d8c918e5c94823a1f609a4bf07fb4c33ee219085'
const SOLIX_NEGOTIATION_COMMAND_5 = 'ff095a000300014022580bc0532a53c739adf3da7b994a7b5f221bcc16bab6392c215cb4faaf41d9d58e2c81c016e474c78eed5569147cb74a1f22ca2b3fad2e209dbbcfbdaca352034a6c479f055f68581b5f1e22348809f526'

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

function toHexStringLimited(data: Uint8Array, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (data.byteLength <= maxBytes) return toHexString(data)

  // Show a stable preview: head + tail, with a middle elision.
  const tailBytes = Math.min(16, Math.max(0, maxBytes - 8))
  const headBytes = Math.max(0, maxBytes - tailBytes)
  const head = data.slice(0, headBytes)
  const tail = tailBytes > 0 ? data.slice(data.byteLength - tailBytes) : new Uint8Array()
  const omitted = Math.max(0, data.byteLength - head.byteLength - tail.byteLength)

  const headHex = head.byteLength ? toHexString(head) : ''
  const tailHex = tail.byteLength ? toHexString(tail) : ''
  if (!tailHex) return `${headHex} ... (+${omitted} bytes)`
  if (!headHex) return `... (+${omitted} bytes) ${tailHex}`
  return `${headHex} ... (+${omitted} bytes) ... ${tailHex}`
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

function normalizeIvFromSerial(serial: string): Uint8Array {
  const serialBytes = new TextEncoder().encode(serial)
  if (serialBytes.length === 16) return serialBytes

  const iv = new Uint8Array(16)
  if (serialBytes.length > 16) {
    iv.set(serialBytes.slice(0, 16), 0)
  } else {
    iv.set(serialBytes, 0)
  }
  return iv
}

function isAckOnlyStatusTlv(tlv: Map<number, Uint8Array>): boolean {
  return tlv.size === 1 && tlv.has(0xa1) && tlv.get(0xa1)!.length === 1
}

function getModeString(mode: number): 'Off' | 'Input' | 'Output' {
  if (mode === 1) return 'Input'
  if (mode === 2) return 'Output'
  return 'Off'
}

function getSolixPortModeString(mode: number): 'Off' | 'Input' | 'Output' {
  // SolixBLE semantics: 0=not connected, 1=output, 2=input
  if (mode === 1) return 'Output'
  if (mode === 2) return 'Input'
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

function parseA2687PortData(value: Uint8Array): AnkerPortData {
  // Observed A2687 layout:
  // [0]=0x04 layout marker
  // [1]=port enabled flag (observed: 0=off, 1=on)
  // [2..3]=millivolts (LE)
  // [4..5]=milliamps? (LE) (empirically: raw/1000 == amps)
  // [6..7]=unknown/unused (often present; may be power or checksum-like)
  if (value.length < 8) return { mode: 'Off', voltage: 0, current: 0, power: 0 }
  const millivolts = parseU16LE(value, 2)
  const currentRaw = parseU16LE(value, 4)
  const enabledFlag = value[1] ?? 0

  // Some firmwares appear to keep the "enabled flag" at 1 even when a port is
  // effectively disabled, but report 0V/0A. Treat that as Off so UI + port-switch
  // post-check can succeed.
  const isEffectivelyOff = enabledFlag === 0 || (millivolts === 0 && currentRaw === 0)
  const mode: 'Off' | 'Output' = isEffectivelyOff ? 'Off' : 'Output'

  if (isEffectivelyOff) {
    // If the port is disabled, treat telemetry as not-present to avoid false positives
    // when no load is connected (some firmwares still report an "Output" voltage).
    return { mode: 'Off', voltage: 0, current: 0, power: 0 }
  }

  const voltage = Math.round((millivolts / 1000) * 1000) / 1000
  const current = Math.round((currentRaw / 1000) * 1000) / 1000
  const computedPower = Math.round(voltage * current * 10) / 10
  return {
    mode,
    voltage,
    current,
    power: computedPower,
  }
}

function emptyPortData(): AnkerPortData {
  return { mode: 'Off', voltage: 0, current: 0, power: 0 }
}

function parseU16LE(data: Uint8Array, index: number): number {
  if (index + 1 >= data.length) return 0
  return data[index]! | (data[index + 1]! << 8)
}

function encodeDerLength(length: number): number[] {
  if (length < 0x80) return [length]
  if (length <= 0xff) return [0x81, length]
  return [0x82, (length >> 8) & 0xff, length & 0xff]
}

function buildP256Pkcs8FromPrivateScalar(privateScalar: Uint8Array): Uint8Array {
  // PKCS#8 for secp256r1 private key with ECPrivateKey payload.
  const ecPrivateKeyBody = [0x02, 0x01, 0x01, 0x04, 0x20, ...privateScalar]
  const ecPrivateKey = [0x30, ...encodeDerLength(ecPrivateKeyBody.length), ...ecPrivateKeyBody]
  const algorithmIdentifier = [
    0x30,
    0x13,
    0x06,
    0x07,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x02,
    0x01,
    0x06,
    0x08,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x03,
    0x01,
    0x07,
  ]
  const privateKeyOctet = [0x04, ...encodeDerLength(ecPrivateKey.length), ...ecPrivateKey]
  const pkcs8Body = [0x02, 0x01, 0x00, ...algorithmIdentifier, ...privateKeyOctet]
  return new Uint8Array([0x30, ...encodeDerLength(pkcs8Body.length), ...pkcs8Body])
}

type SolixTelemetryLayout = 'c300_enc' | 'c1000_enc'

function detectSolixTelemetryLayout(data: Uint8Array): SolixTelemetryLayout | null {
  if (data.byteLength < 200) return null
  // Experimental encrypted layout in SolixBLE branch.
  // C300 mode bytes exist at 139/143/147 and must be in [0,2].
  const c300Mode1 = data[139] ?? 0xff
  const c300Mode2 = data[143] ?? 0xff
  const c300Mode3 = data[147] ?? 0xff
  if (c300Mode1 <= 2 && c300Mode2 <= 2 && c300Mode3 <= 2) return 'c300_enc'

  // C1000 encrypted layout still uses 253-byte payload in that branch.
  const c1000Battery = data[160] ?? 0xff
  if (c1000Battery <= 100) return 'c1000_enc'

  return null
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
  private chargerStatusSource: 'Pending' | 'FF09' | 'SolixEncrypted' = 'Pending'
  private chargerTelemetrySeenAt: number | null = null
  private solixNegotiationStartedAt: number | null = null
  private solixLastInitiationAt = 0
  private solixNegotiationPacketCount = 0
  private solixSharedKey: CryptoKey | null = null
  // Controls noisy per-packet logs; default is intentionally quiet.
  private trafficLogging: 'none' | 'summary' | 'hex' = 'none'
  // Controls high-level status spam.
  private statusLogging: 'none' | 'changes' | 'all' = 'none'
  // Caps giant hex dumps in logs.
  private maxHexBytes = 96
  private logLevel: 'none' | 'info' | 'debug' = 'none'
  private lastStatusLogKey: string | null = null
  private lastStatusLogAt = 0
  // Matches reference: resolveNextNotificationPromise pattern
  private resolveNextNotification: ((data: Uint8Array) => void) | null = null
  private callbacks: AnkerBleCallbacks
  private profile: AnkerBleProfile

  constructor(
    callbacks: AnkerBleCallbacks = {},
    profile: AnkerBleProfile = ANKER_POWERBANK_PROFILE,
    options: {
      trafficLogging?: 'none' | 'summary' | 'hex'
      statusLogging?: 'none' | 'changes' | 'all'
      maxHexBytes?: number
      logLevel?: 'none' | 'info' | 'debug'
    } = {},
  ) {
    this.callbacks = callbacks
    this.profile = profile
    this.trafficLogging = options.trafficLogging ?? 'none'
    this.statusLogging = options.statusLogging ?? 'none'
    this.maxHexBytes = options.maxHexBytes ?? 96
    this.logLevel = options.logLevel ?? 'none'
  }

  private formatHex(data: Uint8Array): string {
    return toHexStringLimited(data, this.maxHexBytes)
  }

  private info(msg: string): void {
    if (this.logLevel === 'none') return
    console.log(`[AnkerBLE] ${msg}`)
    this.callbacks.onLog?.(msg)
  }

  private debug(msg: string): void {
    if (this.logLevel !== 'debug') return
    console.log(`[AnkerBLE] ${msg}`)
    this.callbacks.onLog?.(msg)
  }

  private log(msg: string): void {
    this.info(msg)
  }

  private logTraffic(summary: string, hex?: string): void {
    if (this.trafficLogging === 'none') return
    if (this.trafficLogging === 'hex') {
      this.debug(hex ?? summary)
      return
    }
    this.debug(summary)
  }

  private logStatus(prefix: string, status: AnkerPowerStatus): void {
    if (this.statusLogging === 'none') return

    const key = [
      prefix,
      `b=${status.batteryPercent}`,
      `t=${status.temperature}`,
      `out=${status.totalOutputW}`,
      `C1=${status.usbC1.mode}:${status.usbC1.power}`,
      `C2=${status.usbC2.mode}:${status.usbC2.power}`,
      `C3=${status.usbA.mode}:${status.usbA.power}`,
    ].join('|')

    const now = Date.now()
    if (this.statusLogging === 'changes') {
      // Avoid spamming identical telemetry; still allow periodic refresh.
      if (key === this.lastStatusLogKey && now - this.lastStatusLogAt < 3_000) return
    }

    this.lastStatusLogKey = key
    this.lastStatusLogAt = now

    this.info(
      `    ${prefix}: out=${status.totalOutputW}W C1=${status.usbC1.power}W C2=${status.usbC2.power}W C3=${status.usbA.power}W`,
    )
  }

  private static summarizeCommandPayload(payload: Uint8Array): string {
    // Payload is typically: [0x03,0x00, group, cmdHigh, cmdLow, ...]
    if (payload.byteLength < 5) return `len=${payload.byteLength}`
    const group = payload[2] ?? 0
    const cmdHigh = payload[3] ?? 0
    const cmdLow = payload[4] ?? 0
    const encrypted = (cmdHigh & COMMAND_FLAG_ENCRYPTED) !== 0
    const ack = (cmdHigh & COMMAND_FLAG_ACK) !== 0
    const cmdHighBase = cmdHigh & ~(COMMAND_FLAG_ENCRYPTED | COMMAND_FLAG_ACK)
    const cmd = (cmdHighBase << 8) | cmdLow
    return `group=0x${group.toString(16).padStart(2, '0')} cmd=0x${cmd.toString(16).padStart(4, '0')} enc=${encrypted} ack=${ack} len=${payload.byteLength}`
  }

  get isConnected(): boolean {
    return this.device?.gatt?.connected ?? false
  }

  get currentCryptoState(): CryptoState {
    return this.cryptoState
  }

  private isAllowedDeviceName(deviceName: string | undefined): boolean {
    const prefixes = this.profile.deviceNamePrefixes
    if (!prefixes?.length) return true
    if (!deviceName) return false
    return prefixes.some((prefix) => deviceName.startsWith(prefix))
  }

  async connect(): Promise<void> {
    const namePrefixes = this.profile.deviceNamePrefixes ?? []
    const filters =
      namePrefixes.length > 0
        ? this.profile.advertisedServiceUuids.flatMap((serviceUuid) =>
            namePrefixes.map((namePrefix) => ({ services: [serviceUuid], namePrefix })),
          )
        : this.profile.advertisedServiceUuids.map((serviceUuid) => ({ services: [serviceUuid] }))

    const selectedDevice = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: [this.profile.fullServiceUuid],
    })
    await this.connectToDevice(selectedDevice)
  }

  async connectToDevice(device: BluetoothDevice): Promise<void> {
    try {
      if (!this.isAllowedDeviceName(device.name)) {
        throw new Error(
          `Selected device "${device.name ?? 'Unknown'}" is not supported for ${this.profile.name}.`,
        )
      }

      this.device = device

      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect()
      })

      const server = await this.device.gatt!.connect()
      const service = await server.getPrimaryService(this.profile.fullServiceUuid)

      this.writeChar = await service.getCharacteristic(this.profile.writeCharacteristicUuid)
      this.notifyChar = await service.getCharacteristic(this.profile.notifyCharacteristicUuid)

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

      this.log(`${this.profile.name} BLE connected, waiting for BLE stack to settle...`)
      this.callbacks.onConnectionChange?.(true)

      // Small delay to let BLE stack settle before handshake
      await new Promise((r) => setTimeout(r, 500))

      if (this.profile.name === 'Charger') {
        // A2687 traces show the app uses standard FF09 handshake/session flow.
        this.log('Starting charger handshake/session...')
        try {
          await this.handshake()
        } catch (err) {
          // Keep the older Solix flow as fallback for charger firmware variants.
          this.log(`Charger handshake path failed (${String(err)}), falling back to legacy Solix flow`)
          await this.startChargerEncryptedSession()
        }
      } else {
        this.log('Starting handshake...')
        await this.handshake()
      }
    } catch (err) {
      this.disconnect()
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
    this.chargerStatusSource = 'Pending'
    this.chargerTelemetrySeenAt = null
    this.solixNegotiationStartedAt = null
    this.solixLastInitiationAt = 0
    this.solixNegotiationPacketCount = 0
    this.solixSharedKey = null
    this.resolveNextNotification = null
    this.callbacks.onCryptoStateChange?.('INACTIVE')
    this.callbacks.onConnectionChange?.(false)
  }

  /** Send a framed payload (fire-and-forget write) */
  private async sendPayload(payload: Uint8Array): Promise<void> {
    if (!this.writeChar) throw new Error('Not connected')
    const packet = framePacket(payload)
    this.logTraffic(
      `--> SEND ${AnkerBleService.summarizeCommandPayload(payload)}`,
      `--> SEND (${packet.byteLength} bytes) ${this.formatHex(packet)}`,
    )
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
    this.logTraffic(`<-- RECV len=${rawData.byteLength}`, `<-- RECV (${rawData.byteLength} bytes) ${this.formatHex(rawData)}`)

    if (this.profile.name === 'Charger') {
      if (this.tryHandleChargerSolixNotification(rawData)) return
    }

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

      this.logTraffic(
        `    Command: 0x${fullCommand.toString(16).padStart(4, '0')} enc=${isEncrypted} ack=${isAck}`,
        `    Command: 0x${fullCommand.toString(16).padStart(4, '0')} encrypted=${isEncrypted} ack=${isAck}`,
      )

      if (isEncrypted) {
        if (!this.activeKey) {
          this.logTraffic('    No active key for decryption')
        } else {
          // Some charger responses include a status byte before ciphertext.
          const candidates: Uint8Array[] = [payloadWithHeader.slice(5)]
          if (payloadWithHeader.length > 6) candidates.push(payloadWithHeader.slice(6))

          const tryDecrypt = async (): Promise<Uint8Array> => {
            let lastErr: unknown = null
            for (const candidate of candidates) {
              if (candidate.length < 16) continue
              if (candidate.length % 16 !== 0) continue
              try {
                return await this.decrypt(candidate)
              } catch (err) {
                lastErr = err
              }
            }
            throw lastErr ?? new Error('No valid encrypted payload candidate')
          }

          // Decrypt async — resolve promise after decryption completes
          tryDecrypt()
            .then((decrypted) => {
              this.decryptSuccessCount++
              this.logTraffic(`    Decrypted len=${decrypted.byteLength}`, `    Decrypted: ${this.formatHex(decrypted)}`)

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
              this.logTraffic(`    Decryption error: ${String(err)}`)
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

  private tryHandleChargerSolixNotification(rawData: Uint8Array): boolean {
    if (this.chargerStatusSource === 'FF09') return false

    if (
      rawData.byteLength === 5 &&
      rawData[0] === 0x68 &&
      rawData[1] === 0x65 &&
      rawData[2] === 0x6c &&
      rawData[3] === 0x6c &&
      rawData[4] === 0x6f
    ) {
      this.logTraffic('    Ignoring charger heartbeat payload "hello"')
      return true
    }

    // If it's a normal FF09-framed packet, let the generic parser handle it.
    // Real A2687 captures use framed encrypted commands (group 0x01/0x11).
    if (this.isFramedPacket(rawData)) return false

    if (!this.solixSharedKey) {
      if (!this.solixNegotiationStartedAt) return false
      this.solixNegotiationPacketCount++
      void this.handleSolixNegotiationPacket(rawData).catch((err) => {
        this.log(`Solix negotiation packet handling failed: ${String(err)}`)
      })
      return false
    }

    if (rawData.byteLength < 100) return false

    void this.tryParseEncryptedSolixTelemetry(rawData).catch((err) => {
      this.log(`Encrypted charger telemetry parse failed: ${String(err)}`)
    })
    return true
  }

  private isFramedPacket(rawData: Uint8Array): boolean {
    return rawData.byteLength >= 5 && rawData[0] === FRAME_HEADER_1 && rawData[1] === FRAME_HEADER_2
  }

  private handlePlainResponse(command: number, tlvData: Uint8Array): void {
    const normalizedCommand = command & ~COMMAND_ACK_MASK_16
    const tlv = parseTlv(tlvData)

    // Step 3 response (0x0029): extract device info
    if (normalizedCommand === CMD_HANDSHAKE_INFO) {
      const firmware = tlv.has(0xa3) ? new TextDecoder().decode(tlv.get(0xa3)!) : ''
      const serial = tlv.has(0xa4) ? new TextDecoder().decode(tlv.get(0xa4)!) : ''
      const macBytes = tlv.get(0xa5)
      const mac = macBytes && macBytes.length >= 6
        ? Array.from(macBytes.slice(0, 6))
            .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':')
        : ''

      this.serialNumber = serial
      this.log(`    Device: serial=${serial} mac=${mac} fw=${firmware}`)
      if (this.profile.name === 'Charger' && firmware) {
        this.log(`    Charger firmware field appears to be BLE-module firmware; main charger FW may differ`)
      }
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
      if (isAckOnlyStatusTlv(tlv)) {
        this.log(`    ACK-only status response for 0x${normalizedCommand.toString(16).padStart(4, '0')}, waiting for data`)
        return
      }
      this.parseComprehensiveStatus(tlv)
    } else if (normalizedCommand === CMD_STATUS_LIVE) {
      if (isAckOnlyStatusTlv(tlv)) {
        this.log('    ACK-only live-status response (0x050e), waiting for data')
        return
      }
      this.parseLivePowerStatus(tlv)
    } else if (
      normalizedCommand === CMD_CHARGER_STATUS_FULL ||
      normalizedCommand === CMD_CHARGER_STATUS_LIVE ||
      normalizedCommand === CMD_CHARGER_STATUS_AUX
    ) {
      if (isAckOnlyStatusTlv(tlv)) {
        this.log(
          `    ACK-only charger status response for 0x${normalizedCommand.toString(16).padStart(4, '0')}, waiting for data`,
        )
        return
      }
      this.parseA2687Status(tlv, normalizedCommand)
    } else if (normalizedCommand === CMD_CHARGER_PORT_SWITCH) {
      this.log(
        `    Charger port-switch response TLV: ${Array.from(tlv.entries())
          .map(([type, value]) => `0x${type.toString(16).toUpperCase()}=${toHexString(value)}`)
          .join(' ')}`,
      )
    }
  }

  private parseA2687Status(tlv: Map<number, Uint8Array>, command: number): void {
    const status = clonePowerStatus(this.lastPowerStatus)

    // Observed A2687 totals:
    // A2: [02, lo, hi] output deci-watts
    // A3: [02, lo, hi] input deci-watts
    let tlvOutW: number | null = null
    let tlvInW: number | null = null
    const totalOut = tlv.get(0xa2)
    if (totalOut && totalOut.length >= 3) {
      tlvOutW = parseU16LE(totalOut, 1) / 10
    }
    const totalIn = tlv.get(0xa3)
    if (totalIn && totalIn.length >= 3) {
      tlvInW = parseU16LE(totalIn, 1) / 10
    }

    // User-validated mapping:
    // A5 -> C1, A6 -> C2, A7 -> C3
    if (tlv.has(0xa5)) status.usbC1 = parseA2687PortData(tlv.get(0xa5)!)
    if (tlv.has(0xa6)) status.usbC2 = parseA2687PortData(tlv.get(0xa6)!)
    if (tlv.has(0xa7)) status.usbA = parseA2687PortData(tlv.get(0xa7)!)

    const ports = [status.usbC1, status.usbC2, status.usbA]
    const computedOutW = Math.round(ports.reduce((sum, p) => sum + Math.max(0, p.power), 0) * 10) / 10

    // Charger is AC->DC output device; keep totals output-centric.
    status.totalOutputW = computedOutW
    status.totalInputW = computedOutW

    // Optional charger scalar fields observed in captures.
    const tempOrState = tlv.get(0xa9)
    if (tempOrState && tempOrState.length >= 2) {
      const candidate = tempOrState[1] ?? status.temperature
      if (candidate <= 120) status.temperature = candidate
    }

    this.lastPowerStatus = status
    this.chargerStatusSource = 'FF09'
    this.chargerTelemetrySeenAt = Date.now()
    this.logStatus(`A2687(0x${command.toString(16).padStart(4, '0')})`, status)
    this.callbacks.onPowerStatus?.(status)
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
    if (this.profile.name === 'Charger') {
      this.chargerStatusSource = 'FF09'
      this.chargerTelemetrySeenAt = Date.now()
    }
    this.logStatus('Status', status)
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
    if (this.profile.name === 'Charger') {
      this.chargerStatusSource = 'FF09'
      this.chargerTelemetrySeenAt = Date.now()
    }
    this.logStatus('Live', status)
    this.callbacks.onPowerStatus?.(status)
  }

  private parseSolixTelemetry(rawData: Uint8Array): boolean {
    // Encrypted telemetry branch uses fixed byte offsets after decrypt.
    if (rawData.byteLength < 100) return false
    const layout = detectSolixTelemetryLayout(rawData)
    if (!layout) return false

    const status = clonePowerStatus(this.lastPowerStatus)

    if (layout === 'c300_enc') {
      // C300 encrypted layout from experimental SolixBLE branch.
      status.batteryPercent = rawData[131] ?? status.batteryPercent
      status.totalInputW = parseU16LE(rawData, 65)
      status.totalOutputW = parseU16LE(rawData, 70)

      status.usbC1 = {
        mode: getSolixPortModeString(rawData[139] ?? 0),
        voltage: 0,
        current: 0,
        power: rawData[35] ?? 0,
      }
      status.usbC2 = {
        mode: getSolixPortModeString(rawData[143] ?? 0),
        voltage: 0,
        current: 0,
        power: rawData[40] ?? 0,
      }
      status.usbA = {
        // Shared field for charger USB-C3 in current UI model.
        mode: getSolixPortModeString(rawData[147] ?? 0),
        voltage: 0,
        current: 0,
        power: rawData[45] ?? 0,
      }
    } else {
      // C1000 encrypted layout from branch.
      status.batteryPercent = rawData[160] ?? status.batteryPercent
      status.totalInputW = parseU16LE(rawData, 75)
      status.totalOutputW = parseU16LE(rawData, 80)

      status.usbC1 = {
        mode: getSolixPortModeString(rawData[139] ?? 0),
        voltage: 0,
        current: 0,
        power: rawData[35] ?? 0,
      }
      status.usbC2 = {
        mode: getSolixPortModeString(rawData[143] ?? 0),
        voltage: 0,
        current: 0,
        power: rawData[40] ?? 0,
      }
      status.usbA = {
        mode: getSolixPortModeString(rawData[147] ?? 0),
        voltage: 0,
        current: 0,
        power: rawData[45] ?? 0,
      }
    }

    this.lastPowerStatus = status
    this.chargerStatusSource = 'SolixEncrypted'
    this.chargerTelemetrySeenAt = Date.now()
    this.logStatus(`Charger Telemetry(${layout})`, status)
    this.callbacks.onPowerStatus?.(status)
    return true
  }

  private async tryParseEncryptedSolixTelemetry(rawData: Uint8Array): Promise<void> {
    const decrypted = await this.decryptSolixTelemetryPacket(rawData)
    if (!decrypted) return
    this.logTraffic(`    Decrypted charger telemetry len=${decrypted.byteLength}B`)
    if (!this.parseSolixTelemetry(decrypted)) {
      this.log(`    Decrypted charger payload not recognized (${decrypted.byteLength}B)`)
    }
  }

  private async sendRawCommandPacket(hex: string): Promise<void> {
    if (!this.writeChar) return
    const packet = hexToBytes(hex)
    this.logTraffic(`--> SEND RAW len=${packet.byteLength}`, `--> SEND RAW (${packet.byteLength} bytes) ${this.formatHex(packet)}`)
    if (this.writeChar.properties.write) {
      try {
        await this.writeChar.writeValueWithResponse(packet)
        return
      } catch {
        // Fall through to write-without-response path.
      }
    }
    await this.writeChar.writeValueWithoutResponse(packet)
  }

  private async startSolixNegotiationIfNeeded(): Promise<void> {
    if (this.solixSharedKey) return
    const now = Date.now()
    if (!this.solixNegotiationStartedAt) {
      this.solixNegotiationStartedAt = now
      this.solixLastInitiationAt = 0
      this.solixNegotiationPacketCount = 0
      this.log('Starting charger encrypted telemetry negotiation')
    }

    if (now - this.solixNegotiationStartedAt > SOLIX_NEGOTIATION_TIMEOUT_MS) {
      this.log('Charger encrypted telemetry negotiation timed out')
      return
    }

    if (now - this.solixLastInitiationAt >= SOLIX_NEGOTIATION_RETRY_MS) {
      this.solixLastInitiationAt = now
      await this.sendRawCommandPacket(SOLIX_NEGOTIATION_COMMAND_0)
    }
  }

  private async handleSolixNegotiationPacket(rawData: Uint8Array): Promise<void> {
    switch (this.solixNegotiationPacketCount) {
      case 1:
        await this.sendRawCommandPacket(SOLIX_NEGOTIATION_COMMAND_1)
        return
      case 2:
        await this.sendRawCommandPacket(SOLIX_NEGOTIATION_COMMAND_2)
        return
      case 3:
        await this.sendRawCommandPacket(SOLIX_NEGOTIATION_COMMAND_3)
        return
      case 4:
        await this.sendRawCommandPacket(SOLIX_NEGOTIATION_COMMAND_4)
        return
      case 5:
        this.log('Calculating Solix shared key')
        await this.calculateAndStoreSolixSharedKey(rawData)
        await this.sendRawCommandPacket(SOLIX_NEGOTIATION_COMMAND_5)
        this.cryptoState = 'Session'
        this.callbacks.onCryptoStateChange?.('Session')
        this.log('Solix shared key established')
        this.solixNegotiationStartedAt = null
        return
      default:
        return
    }
  }

  private async calculateAndStoreSolixSharedKey(rawData: Uint8Array): Promise<void> {
    const publicKeyTail = rawData.slice(12, rawData.byteLength - 1)
    if (publicKeyTail.length !== 64) {
      throw new Error(`Unexpected charger public key payload length: ${publicKeyTail.length}`)
    }

    const devicePublicKey = new Uint8Array(65)
    devicePublicKey[0] = 0x04
    devicePublicKey.set(publicKeyTail, 1)

    const importedDevicePublicKey = await crypto.subtle.importKey(
      'raw',
      devicePublicKey as unknown as ArrayBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    )

    const privateScalar = hexToBytes(SOLIX_PRIVATE_KEY_HEX)
    const privatePkcs8 = buildP256Pkcs8FromPrivateScalar(privateScalar)
    const importedPrivateKey = await crypto.subtle.importKey(
      'pkcs8',
      privatePkcs8 as unknown as ArrayBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    )

    const sharedSecretBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: importedDevicePublicKey },
      importedPrivateKey,
      256,
    )
    const sharedSecret = new Uint8Array(sharedSecretBits).slice(0, 16)
    this.solixSharedKey = await crypto.subtle.importKey(
      'raw',
      sharedSecret as unknown as ArrayBuffer,
      { name: 'AES-CBC', length: 128 },
      false,
      ['decrypt'],
    )
  }

  private async decryptSolixTelemetryPacket(rawData: Uint8Array): Promise<Uint8Array | null> {
    if (!this.solixSharedKey) return null
    if (rawData.byteLength <= 45) return null

    const encryptedPayload = rawData.slice(10, rawData.byteLength - 35)
    if (encryptedPayload.byteLength < 16) return null

    const encryptedLength = encryptedPayload.byteLength - (encryptedPayload.byteLength % 16)
    if (encryptedLength < 16) return null
    const encryptedBlockAligned = encryptedPayload.slice(0, encryptedLength)

    try {
      const result = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: new Uint8Array(16) as unknown as ArrayBuffer },
        this.solixSharedKey,
        encryptedBlockAligned as unknown as ArrayBuffer,
      )
      return new Uint8Array(result)
    } catch (err) {
      this.log(`    Failed to decrypt charger telemetry packet: ${String(err)}`)
      return null
    }
  }

  private async startChargerEncryptedSession(): Promise<void> {
    this.solixNegotiationStartedAt = Date.now()
    this.solixLastInitiationAt = 0
    this.solixNegotiationPacketCount = 0
    this.solixSharedKey = null
    this.chargerTelemetrySeenAt = null
    this.chargerStatusSource = 'Pending'
    this.cryptoState = 'Initial'
    this.callbacks.onCryptoStateChange?.('Initial')

    const start = Date.now()
    while (this.solixNegotiationPacketCount === 0) {
      if (Date.now() - start > SOLIX_NEGOTIATION_TIMEOUT_MS) {
        throw new Error('Timed out waiting for charger encrypted negotiation response')
      }
      await this.startSolixNegotiationIfNeeded()
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    while (!this.solixSharedKey) {
      if (Date.now() - start > SOLIX_NEGOTIATION_TIMEOUT_MS) {
        throw new Error('Timed out waiting for charger encrypted shared key')
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    const telemetryDeadline = Date.now() + SOLIX_NEGOTIATION_TIMEOUT_MS
    while (!this.chargerTelemetrySeenAt && Date.now() < telemetryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    if (!this.chargerTelemetrySeenAt) {
      throw new Error('Timed out waiting for charger telemetry after encrypted key establishment')
    }
  }

  private async readChargerTelemetryCharacteristic(): Promise<void> {
    if (!this.notifyChar?.properties.read) return
    try {
      const value = await this.notifyChar.readValue()
      const data = new Uint8Array(value.buffer as ArrayBuffer)
      this.logTraffic(`<-- READ len=${data.byteLength}`, `<-- READ (${data.byteLength} bytes) ${this.formatHex(data)}`)
      this.handleNotification(data)
    } catch (err) {
      this.log(`Charger telemetry read failed: ${String(err)}`)
    }
  }

  private async sendChargerStatusProbe(): Promise<void> {
    // Some charger firmware revisions only emit telemetry after an explicit status request.
    // Try the known status command set as plain FF09-framed probes.
    const probeTlv = [{ type: 0xa1, value: new Uint8Array([0x21]) }]
    for (const command of this.profile.statusCommands) {
      const payload = buildRequestContent(command, probeTlv, GROUP_STATUS)
      this.logTraffic(`Sending charger status probe 0x${command.toString(16).padStart(4, '0')}`)
      await this.sendPayload(payload)
    }
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
    const iv = normalizeIvFromSerial(this.serialNumber)
    this.logTraffic(
      `Initial key len=${initialKey.length}B`,
      `Initial key (${initialKey.length} bytes): ${toHexString(initialKey)}`,
    )
    this.logTraffic(
      `IV derived from serial len=${iv.length}B`,
      `IV from serial "${this.serialNumber}" normalized to ${iv.length} bytes: ${toHexString(iv)}`,
    )
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

    if (this.profile.name === 'Charger') {
      // Helpful with firmware that only emits heartbeat unless poked.
      await this.readChargerTelemetryCharacteristic()
    }

    for (const command of this.profile.statusCommands) {
      await this.sendEncrypted(GROUP_STATUS, command, [{ type: 0xa1, value: new Uint8Array([0x21]) }])
    }

    if (this.profile.name === 'Charger') {
      // Keep plain probes as a fallback trigger for charger variants.
      await this.sendChargerStatusProbe()
    }
  }

  async setChargerPortSwitch(port: 'usbC1' | 'usbC2' | 'usbA', enabled: boolean): Promise<void> {
    if (this.profile.name !== 'Charger') {
      throw new Error('Port switch is only supported for charger profile')
    }
    if (this.cryptoState !== 'Session') {
      throw new Error(`Session key is not active. Current crypto state: ${this.cryptoState}`)
    }

    // RN bundle DevicePort enum: C1=0, C2=1, A=2, Pin=3, C3=4, C4=5
    // RN bundle TURN_ON_OFF enum: OFF=0, ON=1
    // Action: action_set_dc_port_switch with switchIndex / switchOn
    const switchIndexByPort: Record<'usbC1' | 'usbC2' | 'usbA', number> = {
      usbC1: 0,
      usbC2: 1,
      // This UI uses `usbA` to represent the charger's third USB-C port.
      usbA: 4,
    }

    const switchIndex = switchIndexByPort[port]
    const switchOn = enabled ? 1 : 0
    const before = this.lastPowerStatus[port]
    this.info(
      `Port switch: cmd=0x${CMD_CHARGER_PORT_SWITCH.toString(16)} port=${port} index=${switchIndex} val=${switchOn} before=${before.mode}/${before.voltage}V/${before.current}A/${before.power}W`,
    )

    // A2687 port switching (official app / btsnoop):
    // cmd=0x0207 (encrypted) in group=0x0f and uses a 2-block AES-CBC payload.
    //
    // Request TLVs (action_set_dc_port_switch), using the observed uint16 wrapper format:
    // - A1 = 0x31 (constant)
    // - A2 = [0x02, switchIndex, 0x00]  (uint16 LE)
    // - A3 = [0x02, switchOn,   0x00]   (uint16 LE; OFF=0, ON=1)
    // - A4 = [0x01, 0x00]               (uint8; observed present in app traffic)
    const tlvArray = [
      { type: 0xa1, value: new Uint8Array([0x31]) },
      { type: 0xa2, value: new Uint8Array([0x02, switchIndex, 0x00]) },
      { type: 0xa3, value: new Uint8Array([0x02, switchOn, 0x00]) },
      { type: 0xa4, value: new Uint8Array([0x01, 0x00]) },
    ]
    const tlvData = buildTlvBuffer(tlvArray)
    const cipherText = await this.encrypt(tlvData)
    const payload = this.buildEncryptedPayload(GROUP_ACTION, CMD_CHARGER_PORT_SWITCH, cipherText)
    const framedPacketForLog = framePacket(payload)
    this.info(`Port switch TX (${framedPacketForLog.byteLength} bytes)`)
    this.debug(`Port switch TX hex: ${this.formatHex(framedPacketForLog)}`)

    try {
      const response = await this.sendAndWaitForResponse(payload)
      this.info(`Port switch RX (${response.byteLength} bytes)`)
      this.debug(`Port switch RX hex: ${this.formatHex(response)}`)
    } catch (err) {
      this.info(`Port switch send/wait error: ${String(err)}`)
    }

    // Poll status with retries. OFF can take longer for firmware to update the
    // enabled flag in telemetry, so give it more attempts.
    const maxAttempts = enabled ? 3 : 5
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await this.requestStatus()
      await new Promise((resolve) => setTimeout(resolve, 400))

      const now = this.lastPowerStatus[port]
      const success = enabled ? now.mode === 'Output' : now.mode === 'Off'
      this.logTraffic(
        `Port switch poll ${attempt}/${maxAttempts}: ${now.mode}/${now.voltage}V/${now.current}A/${now.power}W success=${success}`,
      )
      if (success) {
        this.info(`Port switch success: port=${port} index=${switchIndex} val=${switchOn} now=${now.mode}/${now.power}W`)
        return
      }
    }

    throw new Error(
      `Port switch command sent but state did not change for ${port} (index=${switchIndex} val=${switchOn})`,
    )
  }
}
