export const DP100_USB_INFO = {
  vendorId: 0x2e3c,
  productId: 0xaf01,
} as const

export const DP100_LIMITS = {
  voltageMin: 0,
  voltageMax: 30,
  currentMin: 0,
  currentMax: 5,
} as const

export const DP100_DEVICE_ADDRESS = 0xfb
export const BASIC_INFO_POLL_MS = 150
export const BASIC_SET_POLL_MS = 2000
