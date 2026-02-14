import { ref, shallowRef } from 'vue'
import {
  AnkerBleService,
  type AnkerDeviceInfo,
  type AnkerPowerStatus,
  type CryptoState,
} from '../services/anker-ble'

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
      }
    },
    onDeviceInfo(info) {
      deviceInfo.value = info
    },
    onPowerStatus(status) {
      powerStatus.value = status
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
  async function connect() {
    error.value = null
    loading.value = true
    try {
      service = createService()
      await service.connect()
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

  return {
    connected,
    loading,
    error,
    cryptoState,
    lastPolledAt,
    deviceInfo,
    powerStatus,
    connect,
    disconnect,
    refreshStatus,
    startPolling,
    stopPolling,
  }
}
