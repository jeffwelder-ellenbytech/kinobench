/**
 * COBS (Consistent Overhead Byte Stuffing) codec.
 * Ensures no 0x00 bytes in the payload; 0x00 marks packet boundary.
 */

export function encode(data: Uint8Array): Uint8Array {
  // Worst case: each 254-byte run adds 1 overhead byte, plus framing delimiter
  const output = new Uint8Array(data.length + Math.ceil(data.length / 254) + 2)
  let writeIdx = 1 // reserve first byte for code
  let codeIdx = 0
  let code = 1

  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x00) {
      output[codeIdx] = code
      codeIdx = writeIdx++
      code = 1
    } else {
      output[writeIdx++] = data[i]!
      code++
      if (code === 0xff) {
        output[codeIdx] = code
        codeIdx = writeIdx++
        code = 1
      }
    }
  }

  output[codeIdx] = code
  // Append 0x00 packet delimiter
  output[writeIdx++] = 0x00

  return output.subarray(0, writeIdx)
}

export function decode(data: Uint8Array): Uint8Array {
  // Strip trailing 0x00 delimiter if present
  let len = data.length
  if (len > 0 && data[len - 1] === 0x00) {
    len--
  }

  const output = new Uint8Array(len)
  let readIdx = 0
  let writeIdx = 0

  while (readIdx < len) {
    let code = data[readIdx]!
    if (code === 0x00) {
      throw new Error('COBS decode: unexpected zero byte in encoded data')
    }
    readIdx++

    for (let i = 1; i < code; i++) {
      if (readIdx >= len) {
        throw new Error('COBS decode: truncated data')
      }
      output[writeIdx++] = data[readIdx]!
      readIdx++
    }

    if (code < 0xff && readIdx < len) {
      output[writeIdx++] = 0x00
    }
  }

  return output.subarray(0, writeIdx)
}
