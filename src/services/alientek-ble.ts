export interface AlientekDeviceInfo {
  id: string
  name: string
  writeCharacteristic: string
  notifyCharacteristic: string
}

export interface AlientekStatus {
  len: number
  voltage: number
  current: number
  power: number
  setpoint: number
  tempC: number
  tempF: number
  runTimeSeconds: number
  runTimeLabel: string
  run: number
  mode: number
  fan: number
  unk1: number
  crcOk: boolean
  rawHex: string
}

export interface AlientekBleCallbacks {
  onConnectionChange?: (connected: boolean) => void
  onDeviceInfo?: (info: AlientekDeviceInfo) => void
  onStatus?: (status: AlientekStatus) => void
  onError?: (error: string) => void
}

const SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb'
const CHAR_FFF1 = '0000fff1-0000-1000-8000-00805f9b34fb'
const CHAR_FFF2 = '0000fff2-0000-1000-8000-00805f9b34fb'
const CHAR_FFF3 = '0000fff3-0000-1000-8000-00805f9b34fb'

function bytesToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function crc8Complement(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]!
  return (256 - (sum % 256)) & 0xff
}

function withCrc(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 1)
  out.set(data, 0)
  out[out.length - 1] = crc8Complement(data)
  return out
}

function isCrcValid(packet: Uint8Array): boolean {
  if (!packet.length) return false
  let sum = 0
  for (let i = 0; i < packet.length; i++) sum += packet[i]!
  return (sum & 0xff) === 0
}

function readFloatLE(data: Uint8Array, start: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return view.getFloat32(start, true)
}

function readInt32LE(data: Uint8Array, start: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return view.getInt32(start, true)
}

function formatRunTime(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds))
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0')
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function decodeStatusPacket(packet: Uint8Array): AlientekStatus {
  const frame = packet.slice(0, 28)
  const voltage = readFloatLE(frame, 7)
  const current = readFloatLE(frame, 11)
  const tempC = readFloatLE(frame, 19)
  const setpoint = readFloatLE(frame, 23)
  const runTimeSeconds = readInt32LE(frame, 15)
  return {
    len: frame.length,
    voltage,
    current,
    power: voltage * current,
    setpoint,
    tempC,
    tempF: tempC * (9 / 5) + 32,
    runTimeSeconds,
    runTimeLabel: formatRunTime(runTimeSeconds),
    unk1: frame[4] ?? 0,
    run: frame[6] ?? 0,
    mode: (frame[5] ?? 0) & 0x0f,
    fan: (frame[5] ?? 0) >> 4,
    crcOk: isCrcValid(frame),
    rawHex: bytesToHex(frame),
  }
}

function canWrite(char: BluetoothRemoteGATTCharacteristic): boolean {
  return !!(char.properties.writeWithoutResponse || char.properties.write)
}

function canNotify(char: BluetoothRemoteGATTCharacteristic): boolean {
  return !!char.properties.notify
}

export class AlientekBleService {
  private callbacks: AlientekBleCallbacks
  private device: BluetoothDevice | null = null
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null
  private commandQueue: Promise<void> = Promise.resolve()

  constructor(callbacks: AlientekBleCallbacks = {}) {
    this.callbacks = callbacks
  }

  get isConnected(): boolean {
    return this.device?.gatt?.connected ?? false
  }

  async connect(): Promise<void> {
    const selectedDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [0xfff0], namePrefix: 'EL15' }],
      optionalServices: [SERVICE_UUID],
    })
    await this.connectToDevice(selectedDevice)
  }

  async connectToDevice(device: BluetoothDevice): Promise<void> {
    this.device = device
    this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect())

    const server = await this.device.gatt!.connect()
    const service = await server.getPrimaryService(SERVICE_UUID)
    const chars = await service.getCharacteristics()

    const byUuid = new Map(chars.map((ch) => [ch.uuid.toLowerCase(), ch]))

    this.writeChar =
      byUuid.get(CHAR_FFF3)?.properties.writeWithoutResponse || byUuid.get(CHAR_FFF3)?.properties.write
        ? byUuid.get(CHAR_FFF3)!
        : byUuid.get(CHAR_FFF1) && canWrite(byUuid.get(CHAR_FFF1)!)
          ? byUuid.get(CHAR_FFF1)!
          : chars.find(canWrite) ?? null

    this.notifyChar =
      byUuid.get(CHAR_FFF2) && canNotify(byUuid.get(CHAR_FFF2)!)
        ? byUuid.get(CHAR_FFF2)!
        : byUuid.get(CHAR_FFF1) && canNotify(byUuid.get(CHAR_FFF1)!)
          ? byUuid.get(CHAR_FFF1)!
          : chars.find(canNotify) ?? null

    if (!this.writeChar || !this.notifyChar) {
      throw new Error('Could not resolve write/notify characteristics.')
    }

    this.notifyChar.addEventListener('characteristicvaluechanged', (event: Event) => {
      const char = event.target as BluetoothRemoteGATTCharacteristic
      if (!char.value) return
      this.handleNotification(new Uint8Array(char.value.buffer as ArrayBuffer))
    })
    await this.notifyChar.startNotifications()

    this.callbacks.onDeviceInfo?.({
      id: this.device.id,
      name: this.device.name ?? 'Unknown',
      writeCharacteristic: this.writeChar.uuid,
      notifyCharacteristic: this.notifyChar.uuid,
    })
    this.callbacks.onConnectionChange?.(true)
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect()
    this.handleDisconnect()
  }

  private handleDisconnect(): void {
    this.device = null
    this.writeChar = null
    this.notifyChar = null
    this.callbacks.onConnectionChange?.(false)
  }

  async requestStatus(): Promise<void> {
    await this.sendCommand(new Uint8Array([0xaf, 0x07, 0x03, 0x08, 0x00]))
  }

  async setLoad(enabled: boolean): Promise<void> {
    // AF 07 03 09 01 00 = load off
    // AF 07 03 09 01 04 = load on
    await this.sendCommand(new Uint8Array([0xaf, 0x07, 0x03, 0x09, 0x01, enabled ? 0x04 : 0x00]))
  }

  async setCurrent(currentA: number): Promise<void> {
    if (!Number.isFinite(currentA) || currentA < 0) {
      throw new Error('Current must be a non-negative number.')
    }
    // AF 07 03 04 04 [float32 LE] [CRC]
    const floatBuffer = new ArrayBuffer(4)
    new DataView(floatBuffer).setFloat32(0, currentA, true)
    const payload = new Uint8Array(9)
    payload.set([0xaf, 0x07, 0x03, 0x04, 0x04], 0)
    payload.set(new Uint8Array(floatBuffer), 5)
    await this.sendCommand(payload)
  }

  async sendCommand(commandWithoutCrc: Uint8Array): Promise<void> {
    const packet = withCrc(commandWithoutCrc)
    return this.enqueueCommand(async () => {
      if (!this.writeChar) throw new Error('Not connected.')
      if (this.writeChar.properties.writeWithoutResponse) {
        await this.writeChar.writeValueWithoutResponse(packet)
      } else if (this.writeChar.properties.write) {
        await this.writeChar.writeValueWithResponse(packet)
      } else {
        await this.writeChar.writeValue(packet)
      }
      // Small guard delay helps devices that choke on tightly packed writes.
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
  }

  private enqueueCommand(task: () => Promise<void>): Promise<void> {
    const next = this.commandQueue.then(task, task)
    this.commandQueue = next.catch(() => {})
    return next
  }

  private handleNotification(raw: Uint8Array): void {
    // Status frame: DF 07 03 08 ...
    if (raw.length >= 28 && raw[0] === 0xdf && raw[1] === 0x07 && raw[2] === 0x03 && raw[3] === 0x08) {
      try {
        const status = decodeStatusPacket(raw)
        this.callbacks.onStatus?.(status)
      } catch (err) {
        this.callbacks.onError?.(err instanceof Error ? err.message : String(err))
      }
    }
  }
}
