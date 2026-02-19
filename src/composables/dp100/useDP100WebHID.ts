import { onMounted, onScopeDispose, shallowRef } from 'vue'
import { DP100_USB_INFO } from '../../services/dp100/constants'

const device = shallowRef<HIDDevice | null>(null)
const error = shallowRef<string | null>(null)

export function useDP100WebHID() {
  const onDisconnected = (event: Event) => {
    const hidEvent = event as HIDConnectionEvent
    if (device.value && hidEvent.device === device.value) {
      device.value = null
    }
  }

  const connect = async () => {
    error.value = null
    try {
      if (!('hid' in navigator)) {
        throw new Error('WebHID is not supported by this browser.')
      }
      const hid = (navigator as Navigator & { hid: HID }).hid
      const devices = await hid.requestDevice({
        filters: [DP100_USB_INFO],
      })

      const selected = devices[0]
      if (!selected) return

      await selected.open()
      device.value = selected
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  const disconnect = async () => {
    if (!device.value) return
    try {
      await device.value.close()
    } finally {
      device.value = null
    }
  }

  onMounted(() => {
    if (!('hid' in navigator)) return
    const hid = (navigator as Navigator & { hid: HID }).hid
    hid.addEventListener('disconnect', onDisconnected)
  })

  onScopeDispose(() => {
    if (!('hid' in navigator)) return
    const hid = (navigator as Navigator & { hid: HID }).hid
    hid.removeEventListener('disconnect', onDisconnected)
  })

  return {
    device,
    error,
    connect,
    disconnect,
  }
}
