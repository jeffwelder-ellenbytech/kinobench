// Web Bluetooth API type declarations
// https://webbluetoothcg.github.io/web-bluetooth/

interface BluetoothRequestDeviceFilter {
  services?: BluetoothServiceUUID[]
  name?: string
  namePrefix?: string
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[]
  optionalServices?: BluetoothServiceUUID[]
  acceptAllDevices?: boolean
}

type BluetoothServiceUUID = number | string

interface BluetoothRemoteGATTDescriptor {
  readonly characteristic: BluetoothRemoteGATTCharacteristic
  readonly uuid: string
  readonly value?: DataView
  readValue(): Promise<DataView>
  writeValue(value: BufferSource): Promise<void>
}

interface BluetoothCharacteristicProperties {
  readonly broadcast: boolean
  readonly read: boolean
  readonly writeWithoutResponse: boolean
  readonly write: boolean
  readonly notify: boolean
  readonly indicate: boolean
  readonly authenticatedSignedWrites: boolean
  readonly reliableWrite: boolean
  readonly writableAuxiliaries: boolean
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly service: BluetoothRemoteGATTService
  readonly uuid: string
  readonly properties: BluetoothCharacteristicProperties
  readonly value?: DataView
  getDescriptor(descriptor: string): Promise<BluetoothRemoteGATTDescriptor>
  getDescriptors(descriptor?: string): Promise<BluetoothRemoteGATTDescriptor[]>
  readValue(): Promise<DataView>
  writeValue(value: ArrayBuffer | Uint8Array): Promise<void>
  writeValueWithResponse(value: ArrayBuffer | Uint8Array): Promise<void>
  writeValueWithoutResponse(value: ArrayBuffer | Uint8Array): Promise<void>
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  oncharacteristicvaluechanged: ((this: BluetoothRemoteGATTCharacteristic, ev: Event) => void) | null
  addEventListener(type: 'characteristicvaluechanged', listener: (this: BluetoothRemoteGATTCharacteristic, ev: Event) => void, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
}

interface BluetoothRemoteGATTService extends EventTarget {
  readonly device: BluetoothDevice
  readonly uuid: string
  readonly isPrimary: boolean
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>
  getCharacteristics(characteristic?: string): Promise<BluetoothRemoteGATTCharacteristic[]>
}

interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice
  readonly connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>
  getPrimaryServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>
}

interface BluetoothDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: BluetoothRemoteGATTServer
  ongattserverdisconnected: ((this: BluetoothDevice, ev: Event) => void) | null
  addEventListener(type: 'gattserverdisconnected', listener: (this: BluetoothDevice, ev: Event) => void, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
}

interface Bluetooth extends EventTarget {
  getAvailability(): Promise<boolean>
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>
}

interface Navigator {
  readonly bluetooth: Bluetooth
}
