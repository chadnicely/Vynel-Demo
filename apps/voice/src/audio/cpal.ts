import { createRequire } from 'node:module'

// node-cpal's shipped `index.d.ts` is out of sync with the v0.1.1 runtime — it
// declares `createInputStream`/`createOutputStream`, but the native binding
// actually exports `createStream(deviceId, isInput, config, cb)` (device ids are
// strings). The README matches the runtime, the `.d.ts` does not. So load it via
// `createRequire` (the native addon's real CJS form) and type it against the
// runtime here — this file is the single, corrected boundary to the lib.

export interface CpalStreamConfig {
  sampleRate: number
  channels: number
  // The binding reports `sampleFormat`; its createStream example shows `format`.
  // We pass the device's own returned config straight back, carrying both.
  sampleFormat?: string
  format?: string
}

// getDefaultInputDevice/getDefaultOutputDevice return an object with a string
// `deviceId` (verified at runtime — the README's prose wrongly says `string`);
// config + createStream take that `deviceId`.
export interface CpalDevice {
  deviceId: string
  name?: string
}

export type CpalStreamHandle = unknown

interface CpalNative {
  getDefaultInputDevice(): CpalDevice
  getDefaultOutputDevice(): CpalDevice
  getDefaultInputConfig(deviceId: string): CpalStreamConfig
  getDefaultOutputConfig(deviceId: string): CpalStreamConfig
  // The callback is REQUIRED by the binding even for output streams (pass a
  // no-op) — omitting it throws "not enough arguments".
  createStream(
    deviceId: string,
    isInput: boolean,
    config: CpalStreamConfig,
    callback: (data: Float32Array) => void,
  ): CpalStreamHandle
  writeToStream(handle: CpalStreamHandle, data: Float32Array): void
  closeStream(handle: CpalStreamHandle): void
}

const require = createRequire(import.meta.url)

export const cpal = require('node-cpal') as CpalNative
