import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EmbeddingModelNotInstalledError,
  configureEmbeddingsCacheDir,
  evictEmbeddingModelCache,
  generateEmbedding,
  isEmbeddingModelInstalled,
} from './index.js'

// The loader never touches the network: a model that is not on the disk is a
// fast, typed answer — what the indexing ticks turn into a download and the
// Settings screen shows — not a 120 s wait on a fetch that cannot happen.

let cacheDir: string
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'vynel-embeddings-'))
  configureEmbeddingsCacheDir(cacheDir)
  await evictEmbeddingModelCache()
})
afterEach(() => rm(cacheDir, { recursive: true, force: true }))

describe('@vynel/embeddings without the model on disk', () => {
  it('reports the model as not installed', async () => {
    expect(await isEmbeddingModelInstalled()).toBe(false)
  })

  it('generateEmbedding rejects at once with the typed error, naming the fix', async () => {
    const started = Date.now()
    await expect(generateEmbedding('hello')).rejects.toBeInstanceOf(EmbeddingModelNotInstalledError)
    await expect(generateEmbedding('hello')).rejects.toThrow(/Settings → Embedding/)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('counts the model as installed only once every catalog file is there', async () => {
    const dir = join(cacheDir, 'Xenova', 'all-MiniLM-L6-v2')
    await mkdir(join(dir, 'onnx'), { recursive: true })
    for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
      await writeFile(join(dir, file), '{}')
    }
    expect(await isEmbeddingModelInstalled()).toBe(false)
    await writeFile(join(dir, 'onnx', 'model_quantized.onnx'), 'x')
    expect(await isEmbeddingModelInstalled()).toBe(true)

    await evictEmbeddingModelCache()
    expect(await isEmbeddingModelInstalled()).toBe(false)
  })
})
