import { crc16modbus } from './crc'
import {
  DP100_DEVICE_ADDRESS,
  BASIC_INFO_POLL_MS,
  BASIC_SET_POLL_MS,
} from './constants'
import { FRAME_FUNC, type Frame, inputReportDataToFrame } from './frame'
import {
  type BasicInfo,
  type BasicSet,
  basicInfoFromFrame,
  basicSetFrameData,
  basicSetFromFrame,
} from './frame-data'

const DEFAULT_RESPONSE_TIMEOUT_MS = 2000

export class DP100 {
  private readonly device: HIDDevice
  private queue: Array<() => Promise<void>> = []
  private runningTask = false
  private closed = false

  public constructor(device: HIDDevice) {
    this.device = device
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          await task()
          resolve()
        } catch (error) {
          reject(error)
        }
      }

      this.queue.push(wrappedTask)
      void this.serviceQueue()
    })
  }

  private async serviceQueue(): Promise<void> {
    if (this.runningTask) {
      return
    }

    this.runningTask = true
    try {
      let task: (() => Promise<void>) | undefined
      while ((task = this.queue.shift())) {
        await task()
      }
    } finally {
      this.runningTask = false
    }
  }

  private async sendFrameForResponse(
    frame: Frame,
    expectedFunctionResponse: number,
    timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
  ): Promise<Frame> {
    if (this.closed) {
      throw new Error('DP100 is closed')
    }

    return new Promise<Frame>((resolve, reject) => {
      void this.enqueue(async () => {
        await new Promise<void>((taskResolve, taskReject) => {
          let timeout: ReturnType<typeof setTimeout> | undefined

          const cleanup = () => {
            if (timeout) {
              clearTimeout(timeout)
            }
            this.device.removeEventListener('inputreport', eventListener)
          }

          const fail = (error: Error) => {
            cleanup()
            reject(error)
            taskReject(error)
          }

          const success = (result: Frame) => {
            cleanup()
            resolve(result)
            taskResolve()
          }

          const eventListener = (event: Event) => {
            const hidEvent = event as HIDInputReportEvent
            const parsedFrame = inputReportDataToFrame(hidEvent.data.buffer)
            if (parsedFrame !== null && parsedFrame.functionType === expectedFunctionResponse) {
              success(parsedFrame)
            }
          }

          this.device.addEventListener('inputreport', eventListener)
          timeout = setTimeout(() => {
            fail(new Error(`Timed out waiting for function ${expectedFunctionResponse}`))
          }, timeoutMs)

          void this.sendFrame(frame).catch((error: Error) => {
            fail(error)
          })
        })
      }).catch((error) => {
        reject(error)
      })
    })
  }

  private async sendFrame(frame: Frame): Promise<void> {
    const frameBuffer = new Uint8Array([
      frame.deviceAddr,
      frame.functionType,
      frame.sequence,
      frame.dataLen,
      ...frame.data,
      0,
      0,
    ])

    const checksum = crc16modbus(frameBuffer.slice(0, frameBuffer.length - 2))
    const frameBufferDv = new DataView(frameBuffer.buffer, frameBuffer.byteOffset, frameBuffer.byteLength)
    frameBufferDv.setUint16(frameBuffer.length - 2, checksum, true)

    await this.device.sendReport(0, frameBuffer)
  }

  public async getBasicInfo(): Promise<BasicInfo> {
    const frameData = new Uint8Array(0)
    const frame: Frame = {
      deviceAddr: DP100_DEVICE_ADDRESS,
      functionType: FRAME_FUNC.FRAME_BASIC_INFO,
      sequence: 0,
      dataLen: frameData.length,
      data: frameData,
    }

    const response = await this.sendFrameForResponse(frame, FRAME_FUNC.FRAME_BASIC_INFO)
    return basicInfoFromFrame(response)
  }

  public async getCurrentBasic(): Promise<BasicSet> {
    const index = 0
    const frameData = new Uint8Array([index | 0x80])
    const frame: Frame = {
      deviceAddr: DP100_DEVICE_ADDRESS,
      functionType: FRAME_FUNC.FRAME_BASIC_SET,
      sequence: 0,
      dataLen: frameData.length,
      data: frameData,
    }

    const response = await this.sendFrameForResponse(frame, FRAME_FUNC.FRAME_BASIC_SET)
    return basicSetFromFrame(response)
  }

  public async setBasic(set: BasicSet): Promise<boolean> {
    const copy = { ...set, index: set.index | 0x20 }
    const frameData = basicSetFrameData(copy)
    const frame: Frame = {
      deviceAddr: DP100_DEVICE_ADDRESS,
      functionType: FRAME_FUNC.FRAME_BASIC_SET,
      sequence: 0,
      dataLen: frameData.length,
      data: frameData,
    }

    const response = await this.sendFrameForResponse(frame, FRAME_FUNC.FRAME_BASIC_SET)
    return response.data[0] === 1
  }

  public close(): void {
    this.closed = true
    this.queue = []
  }
}

export { BASIC_INFO_POLL_MS, BASIC_SET_POLL_MS }
