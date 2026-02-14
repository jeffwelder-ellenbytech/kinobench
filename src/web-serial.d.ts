// Module declarations for CSS imports
declare module 'vuetify/styles' {
  const styles: string
  export default styles
}

// Web Serial API type declarations
// https://wicg.github.io/serial/

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[]
}

interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialOptions {
  baudRate: number
  dataBits?: number
  stopBits?: number
  parity?: 'none' | 'even' | 'odd'
  bufferSize?: number
  flowControl?: 'none' | 'hardware'
}

interface SerialOutputSignals {
  dataTerminalReady?: boolean
  requestToSend?: boolean
  break?: boolean
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
  setSignals(signals: SerialOutputSignals): Promise<void>
}

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
  getPorts(): Promise<SerialPort[]>
}

interface Navigator {
  readonly serial: Serial
}
