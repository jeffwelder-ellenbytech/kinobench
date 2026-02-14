import { encode, decode } from './cobs'

const BP_VID = 0x1209
const BP_PID = 0x7331
const BAUD_RATE = 115200

export type PacketHandler = (data: Uint8Array) => void
export type RawTraceHandler = (direction: 'tx' | 'rx', data: Uint8Array) => void

export class SerialTransport {
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private readLoopActive = false
  private onPacket: PacketHandler | null = null
  private onTrace: RawTraceHandler | null = null
  private buffer = new Uint8Array(0)

  get connected(): boolean {
    return this.port !== null && this.port.readable !== null
  }

  get portInfo(): { vendorId?: number; productId?: number } | null {
    if (!this.port) return null
    const info = this.port.getInfo()
    return { vendorId: info.usbVendorId, productId: info.usbProductId }
  }

  async connect(): Promise<void> {
    this.port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: BP_VID, usbProductId: BP_PID }],
    })
    await this.port.open({ baudRate: BAUD_RATE })
    // Assert DTR and RTS — CDC devices won't send data without DTR
    await this.port.setSignals({ dataTerminalReady: true, requestToSend: true })
    this.startReadLoop()
  }

  async disconnect(): Promise<void> {
    this.readLoopActive = false
    if (this.reader) {
      try {
        await this.reader.cancel()
      } catch {
        // Reader may already be closed
      }
      this.reader = null
    }
    if (this.port) {
      try {
        await this.port.close()
      } catch {
        // Port may already be closed
      }
      this.port = null
    }
    this.buffer = new Uint8Array(0)
  }

  onReceive(handler: PacketHandler): void {
    this.onPacket = handler
  }

  onRawTrace(handler: RawTraceHandler): void {
    this.onTrace = handler
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) {
      throw new Error('Serial port not connected')
    }
    const encoded = encode(data)
    this.onTrace?.('tx', encoded)
    const writer = this.port.writable.getWriter()
    try {
      await writer.write(encoded)
    } finally {
      writer.releaseLock()
    }
  }

  private startReadLoop(): void {
    if (!this.port?.readable) return
    this.readLoopActive = true

    const loop = async () => {
      while (this.readLoopActive && this.port?.readable) {
        try {
          this.reader = this.port.readable.getReader()
          while (this.readLoopActive) {
            const { value, done } = await this.reader.read()
            if (done) break
            if (value) {
              this.onTrace?.('rx', value)
              this.processChunk(value)
            }
          }
        } catch (err) {
          if (this.readLoopActive) {
            console.error('Serial read error:', err)
          }
        } finally {
          if (this.reader) {
            try {
              this.reader.releaseLock()
            } catch {
              // Already released
            }
            this.reader = null
          }
        }
      }
    }

    loop()
  }

  private processChunk(chunk: Uint8Array): void {
    // Append to buffer
    const combined = new Uint8Array(this.buffer.length + chunk.length)
    combined.set(this.buffer)
    combined.set(chunk, this.buffer.length)
    this.buffer = combined

    // Process complete packets (delimited by 0x00)
    let start = 0
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] === 0x00) {
        if (i > start) {
          const packet = this.buffer.slice(start, i + 1) // include delimiter
          try {
            const decoded = decode(packet)
            this.onPacket?.(decoded)
          } catch (err) {
            console.error('COBS decode error:', err)
          }
        }
        start = i + 1
      }
    }

    // Keep unprocessed data in buffer
    if (start > 0) {
      this.buffer = this.buffer.slice(start)
    }
  }
}
