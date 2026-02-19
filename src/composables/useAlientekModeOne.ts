import { ref, shallowRef } from 'vue'
import { AlientekBleService, type AlientekDeviceInfo, type AlientekStatus } from '../services/alientek-ble'

function defaultStatus(): AlientekStatus {
  return {
    len: 28,
    voltage: 0,
    current: 0,
    power: 0,
    setpoint: 0,
    tempC: 0,
    tempF: 32,
    runTimeSeconds: 0,
    runTimeLabel: '00:00:00',
    run: 0,
    mode: 0,
    fan: 0,
    unk1: 0,
    crcOk: false,
    rawHex: '',
  }
}

const connected = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const lastPolledAt = ref<Date | null>(null)
const deviceInfo = shallowRef<AlientekDeviceInfo | null>(null)
const status = shallowRef<AlientekStatus>(defaultStatus())

let service: AlientekBleService | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function clearPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function ensureService(): AlientekBleService {
  if (service) return service
  service = new AlientekBleService({
    onConnectionChange(isConnected) {
      connected.value = isConnected
      if (!isConnected) {
        clearPoll()
      }
    },
    onDeviceInfo(info) {
      deviceInfo.value = info
    },
    onStatus(next) {
      status.value = next
    },
    onError(message) {
      error.value = message
    },
  })
  return service
}

async function connect() {
  error.value = null
  loading.value = true
  try {
    await ensureService().connect()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function disconnect() {
  clearPoll()
  service?.disconnect()
  service = null
}

async function refreshStatus() {
  if (!service) return
  error.value = null
  try {
    await service.requestStatus()
    lastPolledAt.value = new Date()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function setLoad(enabled: boolean) {
  if (!service) return
  error.value = null
  try {
    await service.setLoad(enabled)
    await service.requestStatus()
    lastPolledAt.value = new Date()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  }
}

async function setLock(locked: boolean) {
  if (!service) return
  error.value = null
  try {
    await service.setLock(locked)
    await service.requestStatus()
    lastPolledAt.value = new Date()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  }
}

async function setCurrent(currentA: number) {
  if (!service) return
  error.value = null
  try {
    await service.setCurrent(currentA)
    await service.requestStatus()
    lastPolledAt.value = new Date()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  }
}

async function setBasicSetpoint(value: number) {
  if (!service) return
  error.value = null
  try {
    await service.setBasicSetpoint(value)
    await service.requestStatus()
    lastPolledAt.value = new Date()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  }
}

async function setMode(modeValue: number) {
  if (!service) return
  error.value = null
  try {
    await service.setMode(modeValue)
    await service.requestStatus()
    lastPolledAt.value = new Date()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  }
}

function startPolling(intervalMs: number = 1000) {
  stopPolling()
  if (connected.value && service) {
    service
      .requestStatus()
      .then(() => {
        lastPolledAt.value = new Date()
      })
      .catch(() => {})
  }
  pollTimer = setInterval(() => {
    if (!connected.value || !service) return
    service
      .requestStatus()
      .then(() => {
        lastPolledAt.value = new Date()
      })
      .catch(() => {})
  }, intervalMs)
}

function stopPolling() {
  clearPoll()
}

export function useAlientekModeOne() {
  return {
    connected,
    loading,
    error,
    lastPolledAt,
    deviceInfo,
    status,
    connect,
    disconnect,
    refreshStatus,
    setLoad,
    setLock,
    setCurrent,
    setBasicSetpoint,
    setMode,
    startPolling,
    stopPolling,
  }
}
