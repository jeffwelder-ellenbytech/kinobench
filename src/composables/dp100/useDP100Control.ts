import type { Ref } from 'vue'
import type { DP100 } from '../../services/dp100/dp100'
import type { BasicSet } from '../../services/dp100/frame-data'

export function useDP100Control(dp100: Ref<DP100 | null>, basicSet: Ref<BasicSet | null>) {
  const setVoltage = async (voltage: number) => {
    if (!dp100.value || !basicSet.value) return false
    return dp100.value.setBasic({
      ...basicSet.value,
      vo_set: Math.round(voltage * 1000),
    })
  }

  const setCurrent = async (current: number) => {
    if (!dp100.value || !basicSet.value) return false
    return dp100.value.setBasic({
      ...basicSet.value,
      io_set: Math.round(current * 1000),
    })
  }

  const setOutputState = async (on: boolean) => {
    if (!dp100.value || !basicSet.value) return false
    return dp100.value.setBasic({
      ...basicSet.value,
      state: on ? 1 : 0,
    })
  }

  return {
    setVoltage,
    setCurrent,
    setOutputState,
  }
}
