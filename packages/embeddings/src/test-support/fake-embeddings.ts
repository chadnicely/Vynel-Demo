// Test-support fake for `@vynel/embeddings`. Generates a deterministic
// 384-dim Float32Array from the input string via FNV-1a hashing —
// same input → same vector, different inputs → different vectors.
// NOT a real semantic embedding (just deterministic noise), but
// good enough for repo + core-op tests that need a Buffer of the
// right shape + the right semantic-similarity property
// (identical-input pairs cluster; unrelated inputs scatter).
//
// Memory + knowledge tests `vi.mock('@vynel/embeddings', ...)` and
// substitute this fake. The fake follows the providers test-support
// precedent (`packages/providers/src/test-support/fake-claude-query.ts`).

import { EMBEDDING_DIMENSIONS } from '../index.js'

const FNV_OFFSET_BASIS_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193

function fnv1aHash(input: string): number {
  let hash = FNV_OFFSET_BASIS_32
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0
  }
  return hash
}

export async function fakeGenerateEmbedding(text: string): Promise<Buffer> {
  // Seed a tiny PRNG with the hash; generate 384 float32 in [-1, 1].
  // Linear-congruential for determinism + speed.
  let state = fnv1aHash(text) || 1
  const floats = new Float32Array(EMBEDDING_DIMENSIONS)
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    // Map to [-1, 1]
    floats[i] = (state / 0xffffffff) * 2 - 1
  }
  // L2-normalize so cosine distance behaves predictably across pairs.
  let sumSq = 0
  for (let i = 0; i < floats.length; i++) sumSq += floats[i]! * floats[i]!
  const norm = Math.sqrt(sumSq) || 1
  for (let i = 0; i < floats.length; i++) floats[i]! /= norm
  return Buffer.from(floats.buffer)
}
