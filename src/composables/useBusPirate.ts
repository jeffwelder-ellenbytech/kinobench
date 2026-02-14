import { ref, shallowRef } from 'vue'
import { SerialTransport } from '../services/serial'
import { BusPirateService, type BPStatus, type DataTransferResult } from '../services/buspirate'

export interface TransactionLog {
  timestamp: Date
  type: 'status' | 'config' | 'i2c-read' | 'i2c-write' | 'led'
  detail: string
  result?: string
  error?: string
}

export interface DebugEntry {
  timestamp: Date
  direction: 'tx' | 'rx'
  hex: string
  length: number
}

const transport = new SerialTransport()
let bp: BusPirateService | null = null

const connected = ref(false)
const status = shallowRef<BPStatus | null>(null)
const error = ref<string | null>(null)
const lastResponse = shallowRef<DataTransferResult | null>(null)
const loading = ref(false)
const log = ref<TransactionLog[]>([])
const debugLog = ref<DebugEntry[]>([])
const debugEnabled = ref(true)

function addLog(entry: Omit<TransactionLog, 'timestamp'>) {
  log.value = [{ ...entry, timestamp: new Date() }, ...log.value].slice(0, 100)
}

function formatHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

function toHexString(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

// Wire up debug trace
transport.onRawTrace((direction, data) => {
  if (debugEnabled.value) {
    debugLog.value = [
      {
        timestamp: new Date(),
        direction,
        hex: toHexString(data),
        length: data.length,
      },
      ...debugLog.value,
    ].slice(0, 200)
  }
})

export function useBusPirate() {
  async function connect() {
    error.value = null
    loading.value = true
    try {
      await transport.connect()
      bp = new BusPirateService(transport)
      connected.value = true
      addLog({ type: 'status', detail: 'Connected to Bus Pirate' })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      addLog({ type: 'status', detail: 'Connection failed', error: error.value ?? undefined })
    } finally {
      loading.value = false
    }
  }

  async function disconnect() {
    error.value = null
    loading.value = true
    try {
      await transport.disconnect()
      bp = null
      connected.value = false
      status.value = null
      lastResponse.value = null
      addLog({ type: 'status', detail: 'Disconnected' })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function getStatus() {
    if (!bp) throw new Error('Not connected')
    error.value = null
    loading.value = true
    try {
      status.value = await bp.getStatus()
      addLog({
        type: 'status',
        detail: 'Status request',
        result: `FW ${status.value.firmwareVersion}, Mode: ${status.value.modeCurrent ?? 'HiZ'}`,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      addLog({ type: 'status', detail: 'Status request failed', error: error.value ?? undefined })
    } finally {
      loading.value = false
    }
  }

  async function configureI2C(speed: number, clockStretch = false) {
    if (!bp) throw new Error('Not connected')
    error.value = null
    loading.value = true
    try {
      await bp.configureI2C({ speed, clockStretch })
      addLog({
        type: 'config',
        detail: `I2C configured: ${speed / 1000}kHz, clock stretch: ${clockStretch}`,
      })
      // Refresh status after config change
      await getStatus()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      addLog({ type: 'config', detail: 'I2C config failed', error: error.value ?? undefined })
    } finally {
      loading.value = false
    }
  }

  async function i2cWrite(address: number, data: number[]) {
    if (!bp) throw new Error('Not connected')
    error.value = null
    loading.value = true
    try {
      const result = await bp.dataTransfer({
        startMain: true,
        dataWrite: [(address << 1) & 0xfe, ...data],
        stopMain: true,
      })
      lastResponse.value = result
      if (result.error) {
        error.value = result.error
        addLog({
          type: 'i2c-write',
          detail: `Write 0x${address.toString(16).padStart(2, '0')}: ${formatHex(data)}`,
          error: result.error,
        })
      } else {
        addLog({
          type: 'i2c-write',
          detail: `Write 0x${address.toString(16).padStart(2, '0')}: ${formatHex(data)}`,
          result: 'OK',
        })
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      addLog({ type: 'i2c-write', detail: 'I2C write failed', error: error.value ?? undefined })
    } finally {
      loading.value = false
    }
  }

  async function i2cRead(address: number, count: number) {
    if (!bp) throw new Error('Not connected')
    error.value = null
    loading.value = true
    try {
      const result = await bp.dataTransfer({
        startMain: true,
        dataWrite: [(address << 1) | 0x01],
        bytesRead: count,
        stopMain: true,
      })
      lastResponse.value = result
      if (result.error) {
        error.value = result.error
        addLog({
          type: 'i2c-read',
          detail: `Read 0x${address.toString(16).padStart(2, '0')} x${count}`,
          error: result.error,
        })
      } else {
        addLog({
          type: 'i2c-read',
          detail: `Read 0x${address.toString(16).padStart(2, '0')} x${count}`,
          result: formatHex(result.dataRead),
        })
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      addLog({ type: 'i2c-read', detail: 'I2C read failed', error: error.value ?? undefined })
    } finally {
      loading.value = false
    }
  }

  async function setLedColors(colors: number[]) {
    if (!bp) throw new Error('Not connected')
    error.value = null
    loading.value = true
    try {
      await bp.setLedColors(colors)
      addLog({
        type: 'led',
        detail: `Set ${colors.length} LED(s)`,
        result: colors.map((c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0')).join(', '),
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      addLog({ type: 'led', detail: 'Set LED failed', error: error.value ?? undefined })
    } finally {
      loading.value = false
    }
  }

  async function resumeLeds() {
    if (!bp) throw new Error('Not connected')
    error.value = null
    loading.value = true
    try {
      await bp.resumeLeds()
      addLog({ type: 'led', detail: 'Resumed normal LED behavior', result: 'OK' })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      addLog({ type: 'led', detail: 'Resume LEDs failed', error: error.value ?? undefined })
    } finally {
      loading.value = false
    }
  }

  function clearDebugLog() {
    debugLog.value = []
  }

  return {
    connected,
    status,
    error,
    lastResponse,
    loading,
    log,
    debugLog,
    debugEnabled,
    connect,
    disconnect,
    getStatus,
    configureI2C,
    i2cWrite,
    i2cRead,
    setLedColors,
    resumeLeds,
    clearDebugLog,
  }
}
