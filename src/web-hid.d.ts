interface HIDDeviceFilter {
  vendorId?: number
  productId?: number
  usagePage?: number
  usage?: number
}

interface HIDDeviceRequestOptions {
  filters: HIDDeviceFilter[]
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice
}

interface HIDInputReportEvent extends Event {
  readonly data: DataView
  readonly device: HIDDevice
  readonly reportId: number
}

interface HID extends EventTarget {
  requestDevice(options?: HIDDeviceRequestOptions): Promise<HIDDevice[]>
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  sendReport(reportId: number, data: BufferSource): Promise<void>
}

interface Navigator {
  readonly hid: HID
}
