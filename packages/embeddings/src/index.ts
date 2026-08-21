// `@vynel/embeddings` — text-to-vector embedding for local semantic
// search. Phase 1 model: `all-MiniLM-L6-v2` (quantized q8, ~23 MB) via
// `@huggingface/transformers` (384-dim Float32). Memory + knowledge consume it.
// WHICH model, and its files on disk, is the catalog's say
// (`@vynel/contracts/models/local-model-catalog`) — the Settings screen and
// the probe read the same entry this loads.
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
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers'
import { LOCAL_EMBEDDING_MODEL } from '@vynel/contracts/models/local-model-catalog'

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

const EMBEDDING_MODEL_ID = LOCAL_EMBEDDING_MODEL.source.hfModelId

/** Point the model cache at a stable directory outside node_modules.
 *  Call once at app boot, BEFORE the first `generateEmbedding()`. */
export function configureEmbeddingsCacheDir(cacheDir: string): void {
  env.cacheDir = cacheDir
}

/** Bytes fetched so far across the model's files; `total` once every file has
 *  announced its size, null before. */
export interface EmbeddingModelProgress {
  readonly bytes: number
  readonly total: number | null
}

// Module-level Promise dedupes concurrent first-callers — JS
// single-threaded execution means no further concurrency primitive
// is needed.
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

// transformers.js reports per FILE; the screen wants one bar. Sum what each
// file has said so far — a file that is already cached never reports, which is
// exactly right: nothing to download there.
function aggregateProgress(onProgress: (progress: EmbeddingModelProgress) => void) {
  const byFile = new Map<string, { loaded: number; total: number }>()
  return (info: ProgressInfo): void => {
    if (info.status !== 'progress') return
    byFile.set(info.file, { loaded: info.loaded, total: info.total })
    let bytes = 0
    let total = 0
    for (const file of byFile.values()) {
      bytes += file.loaded
      total += file.total
    }
    onProgress({ bytes, total: total > 0 ? total : null })
  }
}

function loadPipeline(
  onProgress?: (progress: EmbeddingModelProgress) => void,
): Promise<FeatureExtractionPipeline> {
  // q8: ~4× smaller download + faster CPU inference than fp32, with
  // near-identical retrieval quality — the right default for a
  // non-technical user's first run.
  return pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
    dtype: 'q8',
    ...(onProgress ? { progress_callback: aggregateProgress(onProgress) } : {}),
  }) as Promise<FeatureExtractionPipeline>
}

function isCorruptModelCacheError(error: unknown): boolean {
  return error instanceof Error && /protobuf parsing failed/i.test(error.message)
}

async function evictCachedModel(): Promise<void> {
  const modelCacheDir = join(String(env.cacheDir), EMBEDDING_MODEL_ID)
  await rm(modelCacheDir, { recursive: true, force: true }).catch(() => undefined)
}

function getEmbeddingPipeline(
  onProgress?: (progress: EmbeddingModelProgress) => void,
): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        return await loadPipeline(onProgress)
      } catch (error) {
        if (!isCorruptModelCacheError(error)) throw error
        // A truncated download poisoned the cache — evict + retry once.
        await evictCachedModel()
        return await loadPipeline(onProgress)
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

/** Download (if needed) and load the model now, reporting bytes as they land —
 *  the Settings screen's Download. A load already in flight (a service tick got
 *  there first) is joined as-is: its bytes are not observable, only its end. */
export async function warmEmbeddingModel(
  onProgress?: (progress: EmbeddingModelProgress) => void,
): Promise<void> {
  await getEmbeddingPipeline(onProgress)
}

/** Drop the cached model files and forget the warm instance — the Settings
 *  screen's Remove. The next `generateEmbedding()` downloads again. */
export async function evictEmbeddingModelCache(): Promise<void> {
  pipelinePromise = null
  await evictCachedModel()
}

// The first `generateEmbedding()` of a process DOWNLOADS the model (~23 MB from
// the HF Hub). A stalled download never rejects, so without this bound the
// caller waits forever — and the callers are MCP tools (`search_knowledge`,
// `search_memory`, `add_to_knowledge`, `add_memory_from_file`), which means a
// parked agent with no card, no error, and nothing for the user to act on.
const MODEL_LOAD_TIMEOUT_MS = 120_000

// Bound the WAIT, never the load. `pipeline()` takes no AbortSignal, and
// abandoning a half-written model file is exactly the truncated-cache failure
// documented above — worse, a retry would start a SECOND download over the same
// path. So the in-flight promise keeps running (the next call attaches to it and
// may well find it warm); only this caller gives up.
async function awaitEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `@vynel/embeddings: the embedding model did not finish loading within ${MODEL_LOAD_TIMEOUT_MS}ms. ` +
              'It downloads on first use — check the network connection and try again; the download continues in the background.',
          ),
        ),
      MODEL_LOAD_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([getEmbeddingPipeline(), deadline])
  } finally {
    clearTimeout(timer)
  }
}

export async function generateEmbedding(text: string): Promise<Buffer> {
  const extractor = await awaitEmbeddingPipeline()
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
