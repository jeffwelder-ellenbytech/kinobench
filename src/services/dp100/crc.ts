export const crc16modbus = (data: Uint8Array): number => {
  let crc = 0xffff

  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i] ?? 0
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >> 1) ^ 0xa001
      } else {
        crc >>= 1
      }
    }
  }

  return crc & 0xffff
}
