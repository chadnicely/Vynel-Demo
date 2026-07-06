/// <reference path="./sherpa-onnx-node.d.ts" />
import sherpaOnnxNode from 'sherpa-onnx-node'

// The SINGLE point where the native `sherpa-onnx-node` addon is imported. It's a
// CommonJS module whose named exports Node's ESM loader can't statically resolve,
// so `import { OfflineTts }` throws at load — a DEFAULT import (= module.exports)
// is the only reliable form. Everything else in the package imports normal ESM
// bindings from here, keeping the anti-corruption boundary to one file.
export const OfflineTts = sherpaOnnxNode.OfflineTts
export type OfflineTts = InstanceType<typeof OfflineTts>

export const writeWave = sherpaOnnxNode.writeWave

export type { OfflineTtsConfig, GeneratedAudio, TtsRequest } from 'sherpa-onnx-node'
