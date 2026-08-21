import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCAL_EMBEDDING_MODEL } from '@vynel/contracts/models/local-model-catalog'
import {
  MODEL_STAMP_FILE,
  modelInstallDir,
  probeInstalledModel,
  removeInstalledModel,
  writeModelStamp,
} from './installed-model.js'
import { fakeArchiveModel, fakeFileModel, withTempModelsDir } from './test-support/index.js'

describe('installed model probe', () => {
  it('reports the first missing required file, then installed once every file is there', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = fakeArchiveModel('http://unused')
      const dir = modelInstallDir(baseDir, entry)

      expect(await probeInstalledModel(baseDir, entry)).toEqual({
        installed: false,
        missingFile: join(dir, 'model.onnx'),
        installedAt: null,
      })

      await mkdir(join(dir, 'espeak-ng-data'), { recursive: true })
      await writeFile(join(dir, 'model.onnx'), 'x')
      expect((await probeInstalledModel(baseDir, entry)).missingFile).toBe(join(dir, 'tokens.txt'))

      await writeFile(join(dir, 'tokens.txt'), 'x')
      expect(await probeInstalledModel(baseDir, entry)).toEqual({
        installed: true,
        missingFile: null,
        installedAt: null,
      })
    })
  })

  // A dev's existing `.models/` (fetched by the old CLI, or by transformers.js)
  // has no stamp — the files decide; the stamp only adds the date.
  it('counts a hand-fetched model as installed, and reads the stamp when Vynel wrote one', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = fakeFileModel('http://unused')
      const dir = modelInstallDir(baseDir, entry)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'fake-vad.onnx'), 'x')
      expect((await probeInstalledModel(baseDir, entry)).installedAt).toBeNull()

      await writeModelStamp(baseDir, entry, new Date('2026-08-22T10:00:00Z'))
      expect((await probeInstalledModel(baseDir, entry)).installedAt).toBe('2026-08-22T10:00:00.000Z')
      expect(JSON.parse(await readFile(join(dir, MODEL_STAMP_FILE), 'utf8'))).toEqual({
        id: 'fake-vad',
        installedAt: '2026-08-22T10:00:00.000Z',
      })
    })
  })

  it('a stamp it cannot read is ignored — the files decide', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = fakeFileModel('http://unused')
      const dir = modelInstallDir(baseDir, entry)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'fake-vad.onnx'), 'x')
      await writeFile(join(dir, MODEL_STAMP_FILE), '{not json')
      expect(await probeInstalledModel(baseDir, entry)).toMatchObject({ installed: true, installedAt: null })
    })
  })

  it('walks nested folders the way transformers.js lays its cache out', async () => {
    await withTempModelsDir(async (baseDir) => {
      const dir = modelInstallDir(baseDir, LOCAL_EMBEDDING_MODEL)
      expect(dir).toBe(join(baseDir, 'Xenova', 'all-MiniLM-L6-v2'))
      await mkdir(join(dir, 'onnx'), { recursive: true })
      for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
        await writeFile(join(dir, file), '{}')
      }
      expect((await probeInstalledModel(baseDir, LOCAL_EMBEDDING_MODEL)).missingFile).toBe(
        join(dir, 'onnx', 'model_quantized.onnx'),
      )
    })
  })

  it('remove clears the folder and is a no-op when there is none', async () => {
    await withTempModelsDir(async (baseDir) => {
      const entry = fakeFileModel('http://unused')
      await removeInstalledModel(baseDir, entry)
      const dir = modelInstallDir(baseDir, entry)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'fake-vad.onnx'), 'x')
      await removeInstalledModel(baseDir, entry)
      expect((await probeInstalledModel(baseDir, entry)).installed).toBe(false)
    })
  })
})
