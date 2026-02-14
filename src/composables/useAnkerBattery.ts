import { computed, ref, shallowRef } from 'vue'
import {
  AnkerBleService,
  type AnkerDeviceInfo,
  type AnkerPowerStatus,
  type CryptoState,
} from '../services/anker-ble'

export type TelemetryPortKey = 'usbC1' | 'usbC2' | 'usbA'

export interface TelemetrySample {
  tsMs: number
  voltageV: number
  currentA: number
  powerW: number
  accumulatedMah: number
  chargingMs: number
  mode: 'Off' | 'Input' | 'Output'
}

export interface TelemetrySeries {
  tsMs: number[]
  voltageV: number[]
  currentA: number[]
  powerW: number[]
  accumulatedMah: number[]
}

export interface SessionChargeMetrics {
  accumulatedMah: number
  chargingMs: number
}

export interface PortActivity {
  isActive: boolean
  mode: 'Off' | 'Input' | 'Output'
}

const connected = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const cryptoState = ref<CryptoState>('INACTIVE')
const lastPolledAt = ref<Date | null>(null)
const deviceInfo = shallowRef<AnkerDeviceInfo | null>(null)
const powerStatus = shallowRef<AnkerPowerStatus>({
  batteryPercent: 0,
  temperature: 0,
  totalInputW: 0,
  totalOutputW: 0,
  usbC1: { mode: 'Off', voltage: 0, current: 0, power: 0 },
  usbC2: { mode: 'Off', voltage: 0, current: 0, power: 0 },
  usbA: { mode: 'Off', voltage: 0, current: 0, power: 0 },
})

let service: AnkerBleService | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
const TELEMETRY_WINDOW_MS = 10 * 60 * 1000
const telemetryVersion = ref(0)
const selectedTelemetryPort = ref<TelemetryPortKey>('usbC1')
const historyByPort: Record<TelemetryPortKey, TelemetrySample[]> = {
  usbC1: [],
  usbC2: [],
  usbA: [],
}

const portActivity = ref<Record<TelemetryPortKey, PortActivity>>({
  usbC1: { isActive: false, mode: 'Off' },
  usbC2: { isActive: false, mode: 'Off' },
  usbA: { isActive: false, mode: 'Off' },
})

function emptyTelemetrySeries(): TelemetrySeries {
  return {
    tsMs: [],
    voltageV: [],
    currentA: [],
    powerW: [],
    accumulatedMah: [],
  }
}

function resetTelemetryHistory() {
  historyByPort.usbC1.length = 0
  historyByPort.usbC2.length = 0
  historyByPort.usbA.length = 0
  telemetryVersion.value++
}

function setSelectedTelemetryPort(port: TelemetryPortKey) {
  selectedTelemetryPort.value = port
}

function buildTelemetrySeries(port: TelemetryPortKey): TelemetrySeries {
  // Reactive dependency marker: trigger recompute whenever history changes.
  telemetryVersion.value
  const samples = historyByPort[port]
  if (!samples.length) return emptyTelemetrySeries()
  return {
    tsMs: samples.map((s) => s.tsMs),
    voltageV: samples.map((s) => s.voltageV),
    currentA: samples.map((s) => s.currentA),
    powerW: samples.map((s) => s.powerW),
    accumulatedMah: samples.map((s) => s.accumulatedMah),
  }
}

function getSessionChargeMetrics(port: TelemetryPortKey): SessionChargeMetrics {
  telemetryVersion.value
  const samples = historyByPort[port]
  if (!samples.length) return { accumulatedMah: 0, chargingMs: 0 }
  const latest = samples[samples.length - 1]!
  return {
    accumulatedMah: latest.accumulatedMah,
    chargingMs: latest.chargingMs,
  }
}

function updatePortActivity(status: AnkerPowerStatus) {
  const ports: TelemetryPortKey[] = ['usbC1', 'usbC2', 'usbA']
  for (const portKey of ports) {
    const port = status[portKey]
    portActivity.value[portKey] = {
      mode: port.mode,
      isActive: port.mode !== 'Off' && (port.voltage > 0 || port.current > 0 || port.power > 0),
    }
  }
}

function appendTelemetry(status: AnkerPowerStatus) {
  const now = Date.now()
  const ports: TelemetryPortKey[] = ['usbC1', 'usbC2', 'usbA']

  for (const portKey of ports) {
    const port = status[portKey]
    const history = historyByPort[portKey]

    let accumulatedMah = 0
    let chargingMs = 0
    if (history.length > 0) {
      const previous = history[history.length - 1]!
      const deltaHours = (now - previous.tsMs) / 3600000
      const deltaMs = Math.max(now - previous.tsMs, 0)
      const prevCurrent = previous.mode === 'Output' ? previous.currentA : 0
      const currCurrent = port.mode === 'Output' ? port.current : 0
      const deltaMah = ((prevCurrent + currCurrent) / 2) * Math.max(deltaHours, 0) * 1000
      accumulatedMah = previous.accumulatedMah + deltaMah
      chargingMs = previous.chargingMs + (prevCurrent > 0 || currCurrent > 0 ? deltaMs : 0)
    }

    history.push({
      tsMs: now,
      voltageV: port.voltage,
      currentA: port.current,
      powerW: port.power,
      accumulatedMah,
      chargingMs,
      mode: port.mode,
    })

    const cutoff = now - TELEMETRY_WINDOW_MS
    while (history.length > 0 && history[0]!.tsMs < cutoff) {
      history.shift()
    }
  }

  telemetryVersion.value++
}

function clearPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function createService(): AnkerBleService {
  return new AnkerBleService({
    onConnectionChange(isConnected) {
      connected.value = isConnected
      if (!isConnected) {
        clearPoll()
        cryptoState.value = 'INACTIVE'
        lastPolledAt.value = null
        deviceInfo.value = null
        resetTelemetryHistory()
        selectedTelemetryPort.value = 'usbC1'
        portActivity.value = {
          usbC1: { isActive: false, mode: 'Off' },
          usbC2: { isActive: false, mode: 'Off' },
          usbA: { isActive: false, mode: 'Off' },
        }
      }
    },
    onDeviceInfo(info) {
      deviceInfo.value = info
    },
    onPowerStatus(status) {
      powerStatus.value = status
      updatePortActivity(status)
      appendTelemetry(status)
    },
    onCryptoStateChange(state) {
      cryptoState.value = state
    },
    onError(msg) {
      error.value = msg
    },
  })
}

export function useAnkerBattery() {
  const telemetrySeries = computed(() => buildTelemetrySeries(selectedTelemetryPort.value))
  const sessionChargeMetrics = computed(() => getSessionChargeMetrics(selectedTelemetryPort.value))

  function selectFirstActivePort() {
    const ports: TelemetryPortKey[] = ['usbC1', 'usbC2', 'usbA']
    const active = ports.find((p) => portActivity.value[p].isActive)
    selectedTelemetryPort.value = active ?? 'usbC1'
  }

  async function connect() {
    error.value = null
    loading.value = true
    try {
      service = createService()
      await service.connect()
      selectFirstActivePort()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function disconnect() {
    stopPolling()
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

  function startPolling(intervalMs: number = 2000) {
    stopPolling()
    pollTimer = setInterval(() => {
      if (connected.value && service) {
        service
          .requestStatus()
          .then(() => {
            lastPolledAt.value = new Date()
          })
          .catch(() => {})
      }
    }, intervalMs)
  }

  function stopPolling() {
    clearPoll()
  }

  function setTelemetryPort(port: TelemetryPortKey) {
    setSelectedTelemetryPort(port)
  }

  return {
    connected,
    loading,
    error,
    cryptoState,
    lastPolledAt,
    deviceInfo,
    powerStatus,
    telemetrySeries,
    sessionChargeMetrics,
    selectedTelemetryPort,
    portActivity,
    connect,
    disconnect,
    refreshStatus,
    startPolling,
    stopPolling,
    setSelectedTelemetryPort: setTelemetryPort,
    resetTelemetryHistory,
  }
}
