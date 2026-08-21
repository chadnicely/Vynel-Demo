import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError } from '@vynel/errors'
import {
  cancelLocalModelDownload,
  listLocalModelStatuses,
  removeLocalModel,
  startLocalModelDownload,
  type LocalModelsDeps,
} from './local-models.js'
import { ModelDownloadRunner } from './model-download-runner.js'
import { probeInstalledModel } from './installed-model.js'
import {
  fakeFileModel,
  startLocalModelServer,
  withTempModelsDir,
  type LocalModelServer,
} from './test-support/index.js'

let server: LocalModelServer
beforeAll(async () => {
  server = await startLocalModelServer({ '/fake-vad.onnx': Buffer.from('bytes') })
})
afterAll(() => server.close())

function depsFor(baseDir: string, overrides: Partial<LocalModelsDeps> = {}): LocalModelsDeps {
  return {
    catalog: [fakeFileModel(server.baseUrl)],
    baseDirFor: () => baseDir,
    runner: new ModelDownloadRunner(),
    ...overrides,
  }
}

describe('local models', () => {
  it('describes a missing model with its catalog facts and no download', async () => {
    await withTempModelsDir(async (baseDir) => {
      const [status] = await listLocalModelStatuses(depsFor(baseDir))
      expect(status).toEqual({
        id: 'fake-vad',
        kind: 'vad',
        label: 'Fake VAD',
        description: 'A test model.',
        approxBytes: 16,
        speakers: null,
        state: 'missing',
        installedAt: null,
        download: null,
      })
    })
  })

  it('download → downloading, then installed with the stamp date and the job kept', async () => {
    await withTempModelsDir(async (baseDir) => {
      const deps = depsFor(baseDir)
      const job = startLocalModelDownload(deps, 'fake-vad')
      expect(job.status).toBe('downloading')
      expect((await listLocalModelStatuses(deps))[0]!.state).toBe('downloading')

      await deps.runner.whenSettled('fake-vad')
      const [status] = await listLocalModelStatuses(deps)
      expect(status!.state).toBe('installed')
      expect(status!.installedAt).not.toBeNull()
      expect(status!.download).toMatchObject({ bytes: 5, total: 5, error: null })
    })
  })

  it('a failed download reads as failed — until the files turn up another way', async () => {
    await withTempModelsDir(async (baseDir) => {
      const deps = depsFor(baseDir, {
        catalog: [{ ...fakeFileModel(server.baseUrl, 'gone'), folder: 'gone' }],
      })
      startLocalModelDownload(deps, 'gone')
      await deps.runner.whenSettled('gone')
      const [status] = await listLocalModelStatuses(deps)
      expect(status).toMatchObject({ state: 'failed', download: { error: expect.stringMatching(/404/) } })
    })
  })

  it('unknown ids are a not-found on every verb', async () => {
    await withTempModelsDir(async (baseDir) => {
      const deps = depsFor(baseDir)
      expect(() => startLocalModelDownload(deps, 'nope')).toThrow(NotFoundError)
      expect(() => cancelLocalModelDownload(deps, 'nope')).toThrow(NotFoundError)
      await expect(removeLocalModel(deps, 'nope')).rejects.toThrow(NotFoundError)
    })
  })

  it('remove clears the folder, and refuses while a download runs', async () => {
    await withTempModelsDir(async (baseDir) => {
      const deps = depsFor(baseDir)
      startLocalModelDownload(deps, 'fake-vad')
      await expect(removeLocalModel(deps, 'fake-vad')).rejects.toThrow(ConflictError)
      await deps.runner.whenSettled('fake-vad')

      await removeLocalModel(deps, 'fake-vad')
      expect((await probeInstalledModel(baseDir, fakeFileModel(server.baseUrl))).installed).toBe(false)
    })
  })

  // The embedding model's remover must also forget the warm pipeline — only
  // its own package can, so the app lends the hook per source format.
  it('uses the lent remover for its source format', async () => {
    await withTempModelsDir(async (baseDir) => {
      const remover = vi.fn(async () => {})
      const deps = depsFor(baseDir, { removers: { file: remover } })
      await removeLocalModel(deps, 'fake-vad')
      expect(remover).toHaveBeenCalledWith(expect.objectContaining({ id: 'fake-vad' }), baseDir)
    })
  })

  it('cancel answers whether there was anything to cancel', async () => {
    await withTempModelsDir(async (baseDir) => {
      const deps = depsFor(baseDir)
      expect(cancelLocalModelDownload(deps, 'fake-vad')).toBe(false)
    })
  })
})
