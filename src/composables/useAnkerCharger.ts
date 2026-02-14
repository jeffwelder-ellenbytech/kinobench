import { createAnkerDeviceStore } from './createAnkerDeviceStore'
import { ANKER_CHARGER_PROFILE } from '../services/anker-ble'

export {
  type PortActivity,
  type SessionChargeMetrics,
  type TelemetryPortKey,
  type TelemetrySample,
  type TelemetrySeries,
} from './createAnkerDeviceStore'

export const useAnkerCharger = createAnkerDeviceStore(ANKER_CHARGER_PROFILE)
