// `@vynel/embeddings` — text-to-vector embedding for local semantic
// search. Phase 1 model: `all-MiniLM-L6-v2` via `@huggingface/
// transformers` (384-dim Float32). Memory + knowledge consume it.
//
// Lazy first-use cached singleton (per knowledge decisions D23): the
// model loads on the first `generateEmbedding()` call across the
// entire process — whichever worker job tick fires first triggers
// the load. `Promise<Pipeline>` dedupe handles concurrent first-
// callers. Subsequent calls reuse the warm instance. App boot stays
// fast (~25 MB model + ~1 s warm-up cost is one-time per process).
//
// Tests use `@vynel/embeddings/test-support` (the deterministic fake)
// via `vi.mock(...)`. Memory's existing test suite mocks the module
// inline — replacing the throwing stub with the real impl does NOT
// affect test runs (the mock substitutes before the real model can
// load).
//
// Phase 2 considerations: the model location resolution + warm-up
// strategy may shift if Tauri ships with a bundled model file
// (avoids the first-run HF Hub download). The seam (single async
// `generateEmbedding` function) remains stable.

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

export const EMBEDDING_DIMENSIONS = 384
export const EMBEDDING_BYTES = EMBEDDING_DIMENSIONS * 4 // 1536 bytes (384 × float32)

// `<model-name>/<contract-version>` — written to `embeddingModelVersion` on
// every embedding row. Consumers compare row.version against this constant
// to detect "embedded with a stale model" and re-embed. Bump the suffix
// when changing chunking strategy or pre-processing in a way that makes
// old vectors incompatible — not when the model file itself ships a new
// minor revision but the math is unchanged.
export const EMBEDDING_MODEL_VERSION = 'all-MiniLM-L6-v2/v1'

const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

// Module-level Promise dedupes concurrent first-callers — JS
// single-threaded execution means no further concurrency primitive
// is needed.
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline(
      'feature-extraction',
      EMBEDDING_MODEL_ID,
    ) as Promise<FeatureExtractionPipeline>
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
