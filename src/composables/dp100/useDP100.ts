import { onScopeDispose, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { DP100, BASIC_INFO_POLL_MS, BASIC_SET_POLL_MS } from '../../services/dp100/dp100'
import type { BasicInfo, BasicSet } from '../../services/dp100/frame-data'

export function useDP100(device: ShallowRef<HIDDevice | null>) {
  const dp100 = shallowRef<DP100 | null>(null)
  const basicInfo = ref<BasicInfo | null>(null)
  const basicSet = ref<BasicSet | null>(null)

  let infoTimer: ReturnType<typeof setInterval> | null = null
  let setTimer: ReturnType<typeof setInterval> | null = null

  const stopPolling = () => {
    if (infoTimer) {
      clearInterval(infoTimer)
      infoTimer = null
    }
    if (setTimer) {
      clearInterval(setTimer)
      setTimer = null
    }
  }

  const pollBasicInfo = async () => {
    if (!dp100.value) return
    try {
      basicInfo.value = await dp100.value.getBasicInfo()
    } catch {
      // Polling failures are transient while device state changes.
    }
  }

  const pollBasicSet = async () => {
    if (!dp100.value) return
    try {
      basicSet.value = await dp100.value.getCurrentBasic()
    } catch {
      // Polling failures are transient while device state changes.
    }
  }

  const startPolling = () => {
    stopPolling()
    void pollBasicInfo()
    void pollBasicSet()

    infoTimer = setInterval(() => {
      void pollBasicInfo()
    }, BASIC_INFO_POLL_MS)

    setTimer = setInterval(() => {
      void pollBasicSet()
    }, BASIC_SET_POLL_MS)
  }

  watch(
    device,
    (nextDevice) => {
      stopPolling()
      basicInfo.value = null
      basicSet.value = null

      if (!nextDevice) {
        dp100.value?.close()
        dp100.value = null
        return
      }

      dp100.value?.close()
      dp100.value = new DP100(nextDevice)
      startPolling()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    stopPolling()
    dp100.value?.close()
    dp100.value = null
  })

  return {
    dp100,
    basicInfo,
    basicSet,
    startPolling,
    stopPolling,
  }
}
