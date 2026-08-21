import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOCAL_EMBEDDING_MODEL } from '@vynel/contracts/models/local-model-catalog'
import { installModelFromSource } from './install-model-from-source.js'
import { modelInstallDir, probeInstalledModel } from './installed-model.js'
import {
  fakeArchiveModel,
  fakeFileModel,
  startLocalModelServer,
  withTempModelsDir,
  type LocalModelServer,
} from './test-support/index.js'

const VAD_BYTES = Buffer.from('silero-onnx-bytes')
const ARCHIVE_BYTES = Buffer.from('pretend-this-is-a-tar-bz2-archive')

let server: LocalModelServer
beforeAll(async () => {
  server = await startLocalModelServer({
    '/fake-vad.onnx': VAD_BYTES,
    '/fake-tts.tar.bz2': ARCHIVE_BYTES,
    '/broken.tar.bz2': ARCHIVE_BYTES,
  })
})
afterAll(() => server.close())

/** Stands in for `tar`: lays down the archive model's files under `targetDir`. */
async function fakeExtract(archiveName: string, targetDir: string): Promise<void> {
  const folder = archiveName.replace(/\.tar\.bz2$/, '')
  const dir = join(targetDir, folder)
  await mkdir(join(dir, 'espeak-ng-data'), { recursive: true })
  await writeFile(join(dir, 'model.onnx'), 'model')
  await writeFile(join(dir, 'tokens.txt'), 'tokens')
}

describe('installModelFromSource', () => {
  it('fetches a single-file model under its layout name and stamps it', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = fakeFileModel(server.baseUrl)
      await installModelFromSource(baseDir, entry, { now: () => new Date('2026-08-22T12:00:00Z') })

      const dir = modelInstallDir(baseDir, entry)
      expect(await readFile(join(dir, 'fake-vad.onnx'))).toEqual(VAD_BYTES)
      expect(await probeInstalledModel(baseDir, entry)).toEqual({
        installed: true,
        missingFile: null,
        installedAt: '2026-08-22T12:00:00.000Z',
      })
    })
  })

  it('fetches an archive, extracts it beside the folder, removes the archive, verifies and stamps', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = fakeArchiveModel(server.baseUrl)
      const bytesSeen: number[] = []
      await installModelFromSource(baseDir, entry, {
        extract: fakeExtract,
        onProgress: ({ bytes }) => bytesSeen.push(bytes),
      })

      expect((await probeInstalledModel(baseDir, entry)).installed).toBe(true)
      expect(bytesSeen.at(-1)).toBe(ARCHIVE_BYTES.length)
      // Only the model folder remains — the archive is gone.
      expect(await readdir(baseDir)).toEqual(['fake-tts'])
    })
  })

  // The folder is wiped on failure so the probe never mistakes a partial tree
  // for a model, and the next attempt starts clean.
  it('leaves nothing behind when the archive does not contain the layout', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = { ...fakeArchiveModel(server.baseUrl, 'broken'), folder: 'broken' }
      const extractNothingUseful = async (_archive: string, targetDir: string) => {
        await mkdir(join(targetDir, 'broken'), { recursive: true })
        await writeFile(join(targetDir, 'broken', 'README'), 'oops')
      }
      await expect(
        installModelFromSource(baseDir, entry, { extract: extractNothingUseful }),
      ).rejects.toThrow(/finished but .*model\.onnx is missing/)
      expect(await readdir(baseDir)).toEqual([])
    })
  })

  it('leaves nothing behind when the download fails', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = { ...fakeFileModel(server.baseUrl, 'nope'), folder: 'nope' }
      await expect(installModelFromSource(baseDir, entry)).rejects.toThrow(/404/)
      expect(await readdir(baseDir)).toEqual([])
    })
  })

  it('replaces whatever was in the folder before — never a mixed tree', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = fakeFileModel(server.baseUrl)
      const dir = modelInstallDir(baseDir, entry)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'stale.bin'), 'old')
      await installModelFromSource(baseDir, entry)
      expect(await readdir(dir)).not.toContain('stale.bin')
    })
  })

  it('refuses an hf-hub model — transformers.js owns that download', async () => {
    await withTempModelsDir(async (baseDir) => {
      await expect(installModelFromSource(baseDir, LOCAL_EMBEDDING_MODEL)).rejects.toThrow(
        /hf-hub installer/,
      )
    })
  })
})
