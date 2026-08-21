// `@vynel/embeddings` — text-to-vector embedding for local semantic
// search. Phase 1 model: `all-MiniLM-L6-v2` (quantized q8, ~23 MB) via
// `@huggingface/transformers` (384-dim Float32). Memory + knowledge consume it.
// WHICH model, and its files on disk, is the catalog's say
// (`@vynel/contracts/models/local-model-catalog`) — the Settings screen, the
// downloader (`@vynel/models`) and this loader read the same entry.
//
// THE FILES ARRIVE THROUGH `@vynel/models`, NEVER THROUGH transformers.js
// (`env.allowRemoteModels = false`). Its own download-and-cache silently never
// engaged inside the engine: it only caches when `response instanceof Response`,
// and the HTTP server replaces that global — so the weights never reached the
// disk and every load failed with "Unable to get model file path or buffer"
// (found 2026-08-22). A model that is not on the disk fails FAST here with a
// typed error the indexing ticks turn into a download, and the Settings →
// Embedding screen shows; a 120 s wait on a download that cannot happen is not
// an answer.
//
// Lazy first-use cached singleton (per knowledge decisions D23): the
// model loads on the first `generateEmbedding()` call across the
// entire process — whichever service tick fires first triggers the
// load. `Promise<Pipeline>` dedupe handles concurrent first-callers.
// Subsequent calls reuse the warm instance. App boot stays fast
// (~1 s warm-up cost is one-time per process).
//
// CACHE LOCATION: transformers.js defaults to a cache INSIDE
// node_modules — wiped by reinstalls. `configureEmbeddingsCacheDir(dir)` —
// each app's boot points it at a stable dir OUTSIDE node_modules
// (`.models/embeddings` by default, the voice-models precedent). Must run
// before the first `generateEmbedding()`. A load failing with a protobuf
// parse error (a truncated file) evicts the model dir and reports it missing,
// so the next download starts clean.
//
// Tests use `@vynel/embeddings/test-support` (the deterministic fake)
// via `vi.mock(...)`.

import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import {
  LOCAL_EMBEDDING_MODEL,
  requiredModelFiles,
} from '@vynel/contracts/models/local-model-catalog'
import { VynelError } from '@vynel/errors'

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

// Loads come from the disk only — see the header.
env.allowRemoteModels = false

/** Point the model cache at a stable directory outside node_modules.
 *  Call once at app boot, BEFORE the first `generateEmbedding()`. */
export function configureEmbeddingsCacheDir(cacheDir: string): void {
  env.cacheDir = cacheDir
}

/** The model is not on this computer. The indexing ticks start the download
 *  on seeing this; a route carries the message to the person (or to Claude
 *  through an MCP tool) as a 409 — "can't take the request right now, here is
 *  the fix" — instead of a blank 500. */
export class EmbeddingModelNotInstalledError extends VynelError {
  readonly code = 'embedding_model_not_installed'
  readonly httpStatus = 409

  constructor() {
    super(
      'The embedding model is not installed on this computer — download it in Settings → Embedding.',
    )
  }
}

function modelDir(): string {
  return join(String(env.cacheDir), ...LOCAL_EMBEDDING_MODEL.folder.split('/'))
}

/** Every file the catalog lists for the model is on the disk. The same check
 *  `@vynel/models` makes — the list of files has one home, the catalog. */
export async function isEmbeddingModelInstalled(): Promise<boolean> {
  const dir = modelDir()
  for (const relative of requiredModelFiles(LOCAL_EMBEDDING_MODEL)) {
    try {
      await access(join(dir, ...relative.split('/')))
    } catch {
      return false
    }
  }
  return true
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
  await rm(modelDir(), { recursive: true, force: true }).catch(() => undefined)
}

function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      if (!(await isEmbeddingModelInstalled())) throw new EmbeddingModelNotInstalledError()
      try {
        return await loadPipeline()
      } catch (error) {
        if (!isCorruptModelCacheError(error)) throw error
        // A truncated file poisoned the cache — evict it, so the next download
        // starts clean, and say the model is missing (it is, now).
        await evictCachedModel()
        throw new EmbeddingModelNotInstalledError()
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

/** Load the model now — the validation step after a download (a corrupt file
 *  fails here, evicted, rather than on the first search), and a warm-up. */
export async function warmEmbeddingModel(): Promise<void> {
  await getEmbeddingPipeline()
}

/** Drop the model files and forget the warm instance — the Settings screen's
 *  Remove. The next `generateEmbedding()` reports the model missing. */
export async function evictEmbeddingModelCache(): Promise<void> {
  pipelinePromise = null
  await evictCachedModel()
}

// The first `generateEmbedding()` of a process LOADS the model (~1 s). The
// callers are MCP tools (`search_knowledge`, `search_memory`, `add_to_knowledge`,
// `add_memory_from_file`) — a parked agent with no card, no error, and nothing
// for the user to act on is the worst outcome, so the wait is bounded.
const MODEL_LOAD_TIMEOUT_MS = 120_000

// Bound the WAIT, never the load. `pipeline()` takes no AbortSignal; the
// in-flight promise keeps running (the next call attaches to it and may well
// find it warm); only this caller gives up.
async function awaitEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `@vynel/embeddings: the embedding model did not finish loading within ${MODEL_LOAD_TIMEOUT_MS}ms — try again; the load continues in the background.`,
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
