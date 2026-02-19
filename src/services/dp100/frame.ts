import { crc16modbus } from './crc'

export const FRAME_FUNC = {
  FRAME_DEVICE_INFO: 0x10,
  FRAME_FIRM_INFO: 17,
  FRAME_START_TRANS: 18,
  FRAME_DATA_TRANS: 19,
  FRAME_END_TRANS: 20,
  FRAME_DEV_UPGRADE: 21,
  FRAME_BASIC_INFO: 48,
  FRAME_BASIC_SET: 53,
  FRAME_SYSTEM_INFO: 0x40,
  FRAME_SYSTEM_SET: 69,
  FRAME_SCAN_OUT: 80,
  FRAME_SERIAL_OUT: 85,
  FRAM_DISCONNECT: 0x80,
  NONE: 0xff,
} as const

export type FrameFunc = (typeof FRAME_FUNC)[keyof typeof FRAME_FUNC]

export type Frame = {
  deviceAddr: number
  functionType: FrameFunc | number
  sequence: number
  dataLen: number
  data: Uint8Array
}

export const inputReportDataToFrame = (buf: ArrayBufferLike): Frame | null => {
  const frameData = new Uint8Array(buf)
  const frameDv = new DataView(frameData.buffer, frameData.byteOffset, frameData.byteLength)

  const dataLen = frameDv.getUint8(3)
  const frame: Frame = {
    deviceAddr: frameDv.getUint8(0),
    functionType: frameDv.getUint8(1),
    sequence: frameDv.getUint8(2),
    dataLen,
    data: frameData.slice(4, 4 + dataLen),
  }

  const checksum = frameDv.getUint16(4 + dataLen, true)
  const computedChecksum = crc16modbus(frameData.slice(0, 4 + dataLen))
  if (computedChecksum !== checksum) {
    console.warn('Checksum mismatch in received frame', {
      expected: computedChecksum,
      received: checksum,
    })
    return null
  }

  return frame
}
