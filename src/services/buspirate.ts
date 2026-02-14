import * as flatbuffers from 'flatbuffers'
import { SerialTransport } from './serial'
import {
  RequestPacket,
  RequestPacketContents,
  ResponsePacket,
  ResponsePacketContents,
  StatusRequest,
  StatusRequestTypes,
  StatusResponse,
  ConfigurationRequest,
  ConfigurationResponse,
  DataRequest,
  DataResponse,
  ModeConfiguration,
} from '../lib/bpio'

const VERSION_MAJOR = 2
const RESPONSE_TIMEOUT_MS = 5000

export interface BPStatus {
  firmwareVersion: string
  firmwareGitHash: string | null
  firmwareDate: string | null
  hardwareVersion: string
  modeCurrent: string | null
  modesAvailable: string[]
  pinLabels: string[]
  modeMaxWrite: number
  modeMaxRead: number
  psuEnabled: boolean
  psuMv: number
  psuMa: number
  pullupEnabled: boolean
  ledCount: number
}

export interface I2CConfig {
  speed: number
  clockStretch?: boolean
}

export interface DataTransferOpts {
  startMain?: boolean
  startAlt?: boolean
  dataWrite?: number[]
  bytesRead?: number
  stopMain?: boolean
  stopAlt?: boolean
}

export interface DataTransferResult {
  dataRead: number[]
  error: string | null
}

export class BusPirateService {
  private transport: SerialTransport
  private pendingResolve: ((data: Uint8Array) => void) | null = null

  constructor(transport: SerialTransport) {
    this.transport = transport
    this.transport.onReceive((data) => {
      if (this.pendingResolve) {
        const resolve = this.pendingResolve
        this.pendingResolve = null
        resolve(data)
      }
    })
  }

  private sendAndReceive(data: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolve = null
        reject(new Error('Response timeout'))
      }, RESPONSE_TIMEOUT_MS)

      this.pendingResolve = (response) => {
        clearTimeout(timer)
        resolve(response)
      }

      this.transport.send(data).catch((err) => {
        clearTimeout(timer)
        this.pendingResolve = null
        reject(err)
      })
    })
  }

  private buildRequestPacket(
    contentsType: RequestPacketContents,
    contentsOffset: flatbuffers.Offset,
    builder: flatbuffers.Builder,
  ): Uint8Array {
    const packetOffset = RequestPacket.createRequestPacket(
      builder,
      VERSION_MAJOR,
      0,
      contentsType,
      contentsOffset,
    )
    builder.finish(packetOffset)
    return builder.asUint8Array()
  }

  private parseResponsePacket(data: Uint8Array): ResponsePacket {
    const buf = new flatbuffers.ByteBuffer(data)
    return ResponsePacket.getRootAsResponsePacket(buf)
  }

  async getStatus(): Promise<BPStatus> {
    const builder = new flatbuffers.Builder(256)

    const queryVec = StatusRequest.createQueryVector(builder, [StatusRequestTypes.All])
    const statusReqOffset = StatusRequest.createStatusRequest(builder, queryVec)

    const payload = this.buildRequestPacket(
      RequestPacketContents.StatusRequest,
      statusReqOffset,
      builder,
    )

    const responseData = await this.sendAndReceive(payload)
    const response = this.parseResponsePacket(responseData)

    if (response.error()) {
      throw new Error(`Bus Pirate error: ${response.error()}`)
    }

    if (response.contentsType() !== ResponsePacketContents.StatusResponse) {
      throw new Error(`Unexpected response type: ${response.contentsType()}`)
    }

    const status = response.contents(new StatusResponse()) as StatusResponse

    const modesAvailable: string[] = []
    for (let i = 0; i < status.modesAvailableLength(); i++) {
      const mode = status.modesAvailable(i)
      if (mode) modesAvailable.push(mode)
    }

    const pinLabels: string[] = []
    for (let i = 0; i < status.modePinLabelsLength(); i++) {
      const label = status.modePinLabels(i)
      if (label) pinLabels.push(label)
    }

    return {
      firmwareVersion: `${status.versionFirmwareMajor()}.${status.versionFirmwareMinor()}`,
      firmwareGitHash: status.versionFirmwareGitHash(),
      firmwareDate: status.versionFirmwareDate(),
      hardwareVersion: `${status.versionHardwareMajor()}.${status.versionHardwareMinor()}`,
      modeCurrent: status.modeCurrent(),
      modesAvailable,
      pinLabels,
      modeMaxWrite: status.modeMaxWrite(),
      modeMaxRead: status.modeMaxRead(),
      psuEnabled: status.psuEnabled(),
      psuMv: status.psuMeasuredMv(),
      psuMa: status.psuMeasuredMa(),
      pullupEnabled: status.pullupEnabled(),
      ledCount: status.ledCount(),
    }
  }

  async configureI2C(config: I2CConfig): Promise<void> {
    const builder = new flatbuffers.Builder(256)

    const modeStr = builder.createString('I2C')

    ModeConfiguration.startModeConfiguration(builder)
    ModeConfiguration.addSpeed(builder, config.speed)
    if (config.clockStretch !== undefined) {
      ModeConfiguration.addClockStretch(builder, config.clockStretch)
    }
    const modeConfigOffset = ModeConfiguration.endModeConfiguration(builder)

    ConfigurationRequest.startConfigurationRequest(builder)
    ConfigurationRequest.addMode(builder, modeStr)
    ConfigurationRequest.addModeConfiguration(builder, modeConfigOffset)
    const configReqOffset = ConfigurationRequest.endConfigurationRequest(builder)

    const payload = this.buildRequestPacket(
      RequestPacketContents.ConfigurationRequest,
      configReqOffset,
      builder,
    )

    const responseData = await this.sendAndReceive(payload)
    const response = this.parseResponsePacket(responseData)

    if (response.error()) {
      throw new Error(`Configuration error: ${response.error()}`)
    }

    if (response.contentsType() !== ResponsePacketContents.ConfigurationResponse) {
      throw new Error(`Unexpected response type: ${response.contentsType()}`)
    }

    const configResp = response.contents(new ConfigurationResponse()) as ConfigurationResponse
    if (configResp.error()) {
      throw new Error(`Configuration error: ${configResp.error()}`)
    }
  }

  async setLedColors(colors: number[]): Promise<void> {
    const builder = new flatbuffers.Builder(256)

    const colorVec = ConfigurationRequest.createLedColorVector(builder, colors)

    ConfigurationRequest.startConfigurationRequest(builder)
    ConfigurationRequest.addLedColor(builder, colorVec)
    const configReqOffset = ConfigurationRequest.endConfigurationRequest(builder)

    const payload = this.buildRequestPacket(
      RequestPacketContents.ConfigurationRequest,
      configReqOffset,
      builder,
    )

    const responseData = await this.sendAndReceive(payload)
    const response = this.parseResponsePacket(responseData)

    if (response.error()) {
      throw new Error(`LED error: ${response.error()}`)
    }

    if (response.contentsType() !== ResponsePacketContents.ConfigurationResponse) {
      throw new Error(`Unexpected response type: ${response.contentsType()}`)
    }

    const configResp = response.contents(new ConfigurationResponse()) as ConfigurationResponse
    if (configResp.error()) {
      throw new Error(`LED error: ${configResp.error()}`)
    }
  }

  async resumeLeds(): Promise<void> {
    const builder = new flatbuffers.Builder(256)

    ConfigurationRequest.startConfigurationRequest(builder)
    ConfigurationRequest.addLedResume(builder, true)
    const configReqOffset = ConfigurationRequest.endConfigurationRequest(builder)

    const payload = this.buildRequestPacket(
      RequestPacketContents.ConfigurationRequest,
      configReqOffset,
      builder,
    )

    const responseData = await this.sendAndReceive(payload)
    const response = this.parseResponsePacket(responseData)

    if (response.error()) {
      throw new Error(`LED resume error: ${response.error()}`)
    }

    if (response.contentsType() !== ResponsePacketContents.ConfigurationResponse) {
      throw new Error(`Unexpected response type: ${response.contentsType()}`)
    }

    const configResp = response.contents(new ConfigurationResponse()) as ConfigurationResponse
    if (configResp.error()) {
      throw new Error(`LED resume error: ${configResp.error()}`)
    }
  }

  async dataTransfer(opts: DataTransferOpts): Promise<DataTransferResult> {
    const builder = new flatbuffers.Builder(512)

    let dataWriteOffset: flatbuffers.Offset | null = null
    if (opts.dataWrite && opts.dataWrite.length > 0) {
      dataWriteOffset = DataRequest.createDataWriteVector(builder, opts.dataWrite)
    }

    DataRequest.startDataRequest(builder)
    if (opts.startMain) DataRequest.addStartMain(builder, true)
    if (opts.startAlt) DataRequest.addStartAlt(builder, true)
    if (dataWriteOffset) DataRequest.addDataWrite(builder, dataWriteOffset)
    if (opts.bytesRead) DataRequest.addBytesRead(builder, opts.bytesRead)
    if (opts.stopMain) DataRequest.addStopMain(builder, true)
    if (opts.stopAlt) DataRequest.addStopAlt(builder, true)
    const dataReqOffset = DataRequest.endDataRequest(builder)

    const payload = this.buildRequestPacket(
      RequestPacketContents.DataRequest,
      dataReqOffset,
      builder,
    )

    const responseData = await this.sendAndReceive(payload)
    const response = this.parseResponsePacket(responseData)

    if (response.error()) {
      throw new Error(`Data transfer error: ${response.error()}`)
    }

    if (response.contentsType() !== ResponsePacketContents.DataResponse) {
      throw new Error(`Unexpected response type: ${response.contentsType()}`)
    }

    const dataResp = response.contents(new DataResponse()) as DataResponse

    const dataRead: number[] = []
    for (let i = 0; i < dataResp.dataReadLength(); i++) {
      const byte = dataResp.dataRead(i)
      if (byte !== null) dataRead.push(byte)
    }

    return {
      dataRead,
      error: dataResp.error(),
    }
  }
}
