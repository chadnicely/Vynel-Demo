import { describe, expect, it } from 'vitest'
import { ConflictError } from '@vynel/errors'
import { LOCAL_EMBEDDING_MODEL } from '@vynel/contracts/models/local-model-catalog'
import { ModelDownloadRunner, type ModelInstallRequest } from './model-download-runner.js'
import { fakeArchiveModel } from './test-support/index.js'

/** An installer the test drives by hand: it reports progress when told and
 *  settles when told. */
function deferredInstaller() {
  let request!: ModelInstallRequest
  let resolve!: () => void
  let reject!: (error: Error) => void
  const done = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const installer = (incoming: ModelInstallRequest) => {
    request = incoming
    return done
  }
  return {
    installer,
    progress: (bytes: number, total: number | null) => request.onProgress({ bytes, total }),
    signal: () => request.signal,
    finish: () => resolve(),
    fail: (message: string) => reject(new Error(message)),
  }
}

const clock = () => new Date('2026-08-22T12:00:00Z')

describe('ModelDownloadRunner', () => {
  it('runs one job per model: progress is readable while it runs, the outcome after', async () => {
    const archive = deferredInstaller()
    const runner = new ModelDownloadRunner({ installers: { archive: archive.installer }, now: clock })
    const entry = fakeArchiveModel('http://unused')

    const started = runner.start(entry, '/models')
    expect(started).toEqual({
      modelId: 'fake-tts',
      status: 'downloading',
      bytes: 0,
      total: entry.approxBytes,
      error: null,
      startedAt: '2026-08-22T12:00:00.000Z',
      finishedAt: null,
    })

    archive.progress(10, 100)
    expect(runner.get('fake-tts')).toMatchObject({ bytes: 10, total: 100, status: 'downloading' })
    // A server that does not say its size keeps the catalog's estimate.
    archive.progress(20, null)
    expect(runner.get('fake-tts')).toMatchObject({ bytes: 20, total: 100 })

    archive.finish()
    expect(await runner.whenSettled('fake-tts')).toMatchObject({
      status: 'installed',
      bytes: 100,
      finishedAt: '2026-08-22T12:00:00.000Z',
    })
    expect(runner.list()).toHaveLength(1)
  })

  it('refuses a second start while the first is still running, allows one after it settled', async () => {
    const archive = deferredInstaller()
    const runner = new ModelDownloadRunner({ installers: { archive: archive.installer } })
    const entry = fakeArchiveModel('http://unused')
    runner.start(entry, '/models')
    expect(() => runner.start(entry, '/models')).toThrow(ConflictError)

    archive.finish()
    await runner.whenSettled('fake-tts')
    const again = deferredInstaller()
    const restartable = new ModelDownloadRunner({ installers: { archive: again.installer } })
    restartable.start(entry, '/models')
    again.finish()
    expect((await restartable.whenSettled('fake-tts')).status).toBe('installed')
  })

  it('keeps a failure readable, with the installer’s message', async () => {
    const archive = deferredInstaller()
    const runner = new ModelDownloadRunner({ installers: { archive: archive.installer } })
    runner.start(fakeArchiveModel('http://unused'), '/models')
    archive.fail('download failed (503 Service Unavailable)')
    expect(await runner.whenSettled('fake-tts')).toMatchObject({
      status: 'failed',
      error: 'download failed (503 Service Unavailable)',
    })
  })

  it('cancel aborts the installer’s signal and records the job as cancelled', async () => {
    const archive = deferredInstaller()
    const runner = new ModelDownloadRunner({ installers: { archive: archive.installer } })
    runner.start(fakeArchiveModel('http://unused'), '/models')
    expect(runner.cancel('fake-tts')).toBe(true)
    expect(archive.signal().aborted).toBe(true)
    archive.fail('aborted')
    expect(await runner.whenSettled('fake-tts')).toMatchObject({ status: 'failed', error: 'Cancelled.' })
    expect(runner.cancel('fake-tts')).toBe(false)
  })

  // transformers.js owns the embedding download; without the lent installer the
  // runner must say so rather than fetch from a URL that does not exist.
  it('has no default installer for hf-hub models', () => {
    const runner = new ModelDownloadRunner()
    expect(() => runner.start(LOCAL_EMBEDDING_MODEL, '/models')).toThrow(/no installer for "hf-hub"/)
    expect(runner.get(LOCAL_EMBEDDING_MODEL.id)).toBeNull()
  })

  it('answers null for a model it never started', () => {
    expect(new ModelDownloadRunner().get('nothing')).toBeNull()
  })
})
