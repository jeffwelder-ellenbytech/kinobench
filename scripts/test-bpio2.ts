#!/usr/bin/env bun
/**
 * Quick BPIO2 test script — bypasses the browser to test if the Bus Pirate
 * responds on the BPIO2 serial port.
 *
 * Prerequisites:
 *   1. Enable BPIO2 on the Bus Pirate terminal: type `binmode`, select option 2
 *   2. Run: bun scripts/test-bpio2.ts /dev/cu.usbmodem6buspirate3
 */

import { SerialPort } from 'serialport'

const portPath = process.argv[2]
if (!portPath) {
  console.error('Usage: bun scripts/test-bpio2.ts <serial-port>')
  console.error('  e.g. bun scripts/test-bpio2.ts /dev/cu.usbmodem6buspirate3')
  process.exit(1)
}

// COBS encode
function cobsEncode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + Math.ceil(data.length / 254) + 2)
  let wi = 1, ci = 0, code = 1
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x00) {
      out[ci] = code; ci = wi++; code = 1
    } else {
      out[wi++] = data[i]!; code++
      if (code === 0xff) { out[ci] = code; ci = wi++; code = 1 }
    }
  }
  out[ci] = code
  out[wi++] = 0x00
  return out.subarray(0, wi)
}

// Build a minimal StatusRequest FlatBuffer packet
// This is the same packet our web app sends
import * as flatbuffers from 'flatbuffers'
import { RequestPacket } from '../src/lib/bpio/request-packet.js'
import { RequestPacketContents } from '../src/lib/bpio/request-packet-contents.js'
import { StatusRequest } from '../src/lib/bpio/status-request.js'
import { StatusRequestTypes } from '../src/lib/bpio/status-request-types.js'

const builder = new flatbuffers.Builder(256)
const queryVec = StatusRequest.createQueryVector(builder, [StatusRequestTypes.All])
const statusReq = StatusRequest.createStatusRequest(builder, queryVec)
const packet = RequestPacket.createRequestPacket(builder, 2, 0, RequestPacketContents.StatusRequest, statusReq)
builder.finish(packet)
const fbBytes = builder.asUint8Array()
const cobsPacket = cobsEncode(fbBytes)

function toHex(buf: Uint8Array | Buffer): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

console.log(`Opening ${portPath} at 115200 baud...`)
const port = new SerialPort({ path: portPath, baudRate: 115200 })

port.on('open', () => {
  console.log('Port opened. Sending StatusRequest...')
  console.log(`TX (${cobsPacket.length} bytes): ${toHex(cobsPacket)}`)
  port.write(Buffer.from(cobsPacket))
})

let rxBuffer = Buffer.alloc(0)
port.on('data', (chunk: Buffer) => {
  console.log(`RX chunk (${chunk.length} bytes): ${toHex(chunk)}`)
  rxBuffer = Buffer.concat([rxBuffer, chunk])

  // Look for 0x00 delimiter
  const zeroIdx = rxBuffer.indexOf(0x00)
  if (zeroIdx >= 0) {
    const fullPacket = rxBuffer.subarray(0, zeroIdx + 1)
    console.log(`\nComplete COBS packet (${fullPacket.length} bytes): ${toHex(fullPacket)}`)
    console.log('BPIO2 is responding! The web app should work now.')
    rxBuffer = rxBuffer.subarray(zeroIdx + 1)
  }
})

port.on('error', (err) => {
  console.error('Serial error:', err.message)
})

// Timeout after 5 seconds
setTimeout(() => {
  if (rxBuffer.length === 0) {
    console.log('\nNo response after 5 seconds.')
    console.log('Make sure you enabled BPIO2: on the terminal port, type `binmode` and select option 2.')
  }
  port.close()
  process.exit(rxBuffer.length > 0 ? 0 : 1)
}, 5000)
