// `@vynel/embeddings` — text-to-vector embedding for local semantic
// search. Phase 1 model: `all-MiniLM-L6-v2` (quantized q8, ~23 MB) via
// `@huggingface/transformers` (384-dim Float32). Memory + knowledge consume it.
//
// Lazy first-use cached singleton (per knowledge decisions D23): the
// model loads on the first `generateEmbedding()` call across the
// entire process — whichever service tick fires first triggers the
// load. `Promise<Pipeline>` dedupe handles concurrent first-callers.
// Subsequent calls reuse the warm instance. App boot stays fast
// (~23 MB model + ~1 s warm-up cost is one-time per process).
//
// CACHE LOCATION: transformers.js defaults to a cache INSIDE
// node_modules — wiped by reinstalls, and a process killed mid-first-
// download leaves a TRUNCATED model file it then trusts forever
// ("Protobuf parsing failed" on every load — seen live 2026-07-11).
// Two defenses:
//   1. `configureEmbeddingsCacheDir(dir)` — each app's boot points the
//      cache at a stable dir OUTSIDE node_modules (`.models/embeddings`
//      by default, the voice-models precedent). Must run before the
//      first generateEmbedding().
//   2. Corrupt-cache self-healing: a load failing with a protobuf
//      parse error evicts the cached model dir and retries ONCE — an
//      interrupted first download heals on the next tick instead of
//      failing forever.
//
// Tests use `@vynel/embeddings/test-support` (the deterministic fake)
// via `vi.mock(...)`.
//
// Phase 2 considerations: the model location resolution + warm-up
// strategy may shift if Tauri ships with a bundled model file
// (avoids the first-run HF Hub download). The seam (single async
// `generateEmbedding` function) remains stable.

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

export const EMBEDDING_DIMENSIONS = 384
export const EMBEDDING_BYTES = EMBEDDING_DIMENSIONS * 4 // 1536 bytes (384 × float32)

// `<model-name>/<contract-version>` — written to `embeddingModelVersion` on
// every embedding row. Consumers compare row.version against this constant
// to detect "embedded with a stale model" and re-embed. Bump the suffix
// when changing chunking strategy or pre-processing in a way that makes
// old vectors incompatible — not when the model file itself ships a new
// minor revision but the math is unchanged. (q8 quantization landed
// 2026-07-11 WITHOUT a bump: no fp32 vector was ever successfully
// generated anywhere — the worker never ran and the api-side download
// never completed — so there is nothing to invalidate.)
export const EMBEDDING_MODEL_VERSION = 'all-MiniLM-L6-v2/v1'

const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

/** Point the model cache at a stable directory outside node_modules.
 *  Call once at app boot, BEFORE the first `generateEmbedding()`. */
export function configureEmbeddingsCacheDir(cacheDir: string): void {
  env.cacheDir = cacheDir
}

// Module-level Promise dedupes concurrent first-callers — JS
// single-threaded execution means no further concurrency primitive
// is needed.
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

function loadPipeline(): Promise<FeatureExtractionPipeline> {
  // q8: ~4× smaller download + faster CPU inference than fp32, with
  // near-identical retrieval quality — the right default for a
  // non-technical user's first run.
  return pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
    dtype: 'q8',
  }) as Promise<FeatureExtractionPipeline>
}

function isCorruptModelCacheError(error: unknown): boolean {
  return error instanceof Error && /protobuf parsing failed/i.test(error.message)
}

async function evictCachedModel(): Promise<void> {
  const modelCacheDir = join(String(env.cacheDir), EMBEDDING_MODEL_ID)
  await rm(modelCacheDir, { recursive: true, force: true }).catch(() => undefined)
}

async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        return await loadPipeline()
      } catch (error) {
        if (!isCorruptModelCacheError(error)) throw error
        // A truncated download poisoned the cache — evict + retry once.
        await evictCachedModel()
        return await loadPipeline()
      }
    })()
    // A failed load must not poison every future call with the same
    // rejected promise — reset so the next tick retries fresh.
    pipelinePromise.catch(() => {
      pipelinePromise = null
    })
  }
  return pipelinePromise
}

export async function generateEmbedding(text: string): Promise<Buffer> {
  const extractor = await getEmbeddingPipeline()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  // After mean-pooling + L2-normalization, `output.data` is a Float32Array
  // of length EMBEDDING_DIMENSIONS.
  const floats = output.data as Float32Array
  if (floats.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `@vynel/embeddings.generateEmbedding: unexpected embedding length ${floats.length} (expected ${EMBEDDING_DIMENSIONS})`,
    )
  }
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)
}
