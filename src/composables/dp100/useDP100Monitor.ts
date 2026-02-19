import { computed, ref, watch, type Ref } from 'vue'
import type { BasicInfo } from '../../services/dp100/frame-data'

export interface MonitorPoint {
  timestamp: number
  voltage: number
  current: number
  power: number
}

const MAX_POINTS = 600

export function useDP100Monitor(basicInfo: Ref<BasicInfo | null>) {
  const points = ref<MonitorPoint[]>([])
  const showPower = ref(false)

  watch(basicInfo, (next) => {
    if (!next) return

    const voltage = next.vout / 1000
    const current = next.iout / 1000
    const point: MonitorPoint = {
      timestamp: Date.now(),
      voltage,
      current,
      power: voltage * current,
    }

    const nextPoints = [...points.value, point]
    if (nextPoints.length > MAX_POINTS) {
      nextPoints.splice(0, nextPoints.length - MAX_POINTS)
    }
    points.value = nextPoints
  })

  const chartData = computed(() =>
    points.value.map((point) => ({
      time: point.timestamp,
      voltage: point.voltage,
      current: point.current,
      power: point.power,
    })),
  )

  const clear = () => {
    points.value = []
  }

  return {
    points,
    showPower,
    chartData,
    clear,
  }
}
