import type { LocalModelEntry, LocalModelSource } from '@vynel/contracts/models/local-model-catalog'
import { ConflictError } from '@vynel/errors'
import type { DownloadProgress } from './download-to-file.js'
import { installModelFromSource } from './install-model-from-source.js'

export type ModelDownloadStatus = 'downloading' | 'installed' | 'failed'

/** One download, as the Settings screen polls it. Kept after it settles so the
 *  outcome is readable until the next start for the same model. */
export interface ModelDownloadJob {
  readonly modelId: string
  readonly status: ModelDownloadStatus
  readonly bytes: number
  readonly total: number | null
  readonly error: string | null
  readonly startedAt: string
  readonly finishedAt: string | null
}

export interface ModelInstallRequest {
  readonly entry: LocalModelEntry
  readonly baseDir: string
  readonly onProgress: (progress: DownloadProgress) => void
  readonly signal: AbortSignal
}

export type ModelInstaller = (request: ModelInstallRequest) => Promise<void>

export interface ModelDownloadRunnerOptions {
  /** Per source format; every format defaults to the URL installer. An app
   *  overrides one to add a step — the engine validates the embedding model
   *  by loading it once after the files land. */
  readonly installers?: Partial<Record<LocalModelSource['format'], ModelInstaller>>
  readonly now?: () => Date
}

interface MutableJob {
  modelId: string
  status: ModelDownloadStatus
  bytes: number
  total: number | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

const urlInstaller: ModelInstaller = ({ entry, baseDir, onProgress, signal }) =>
  installModelFromSource(baseDir, entry, { onProgress, signal })

// The one place a model download runs: one job per model at a time, progress
// read back by polling, the outcome kept. In-memory on purpose — a download is
// a single step, and a process that dies mid-way leaves an unfinished folder the
// probe already reports as missing and the next start wipes. Genuinely
// stateful, hence a class.
export class ModelDownloadRunner {
  readonly #jobs = new Map<string, MutableJob>()
  readonly #settled = new Map<string, Promise<ModelDownloadJob>>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #installers: Partial<Record<LocalModelSource['format'], ModelInstaller>>
  readonly #now: () => Date

  constructor(options: ModelDownloadRunnerOptions = {}) {
    this.#installers = {
      archive: urlInstaller,
      file: urlInstaller,
      'hf-hub': urlInstaller,
      ...options.installers,
    }
    this.#now = options.now ?? (() => new Date())
  }

  start(entry: LocalModelEntry, baseDir: string): ModelDownloadJob {
    const running = this.#jobs.get(entry.id)
    if (running?.status === 'downloading') {
      throw new ConflictError(`"${entry.label}" is already downloading.`)
    }
    const installer = this.#installers[entry.source.format]
    if (installer === undefined) {
      throw new Error(`@vynel/models: no installer for "${entry.source.format}" models.`)
    }

    const job: MutableJob = {
      modelId: entry.id,
      status: 'downloading',
      bytes: 0,
      total: entry.approxBytes,
      error: null,
      startedAt: this.#now().toISOString(),
      finishedAt: null,
    }
    const controller = new AbortController()
    this.#jobs.set(entry.id, job)
    this.#controllers.set(entry.id, controller)

    const settled = installer({
      entry,
      baseDir,
      signal: controller.signal,
      onProgress: ({ bytes, total }) => {
        job.bytes = bytes
        if (total !== null) job.total = total
      },
    })
      .then(() => {
        job.status = 'installed'
        job.bytes = job.total ?? job.bytes
      })
      .catch((error: unknown) => {
        job.status = 'failed'
        job.error = controller.signal.aborted
          ? 'Cancelled.'
          : error instanceof Error
            ? error.message
            : String(error)
      })
      .then(() => {
        job.finishedAt = this.#now().toISOString()
        this.#controllers.delete(entry.id)
        return snapshot(job)
      })
    this.#settled.set(entry.id, settled)
    return snapshot(job)
  }

  get(modelId: string): ModelDownloadJob | null {
    const job = this.#jobs.get(modelId)
    return job === undefined ? null : snapshot(job)
  }

  list(): ModelDownloadJob[] {
    return [...this.#jobs.values()].map(snapshot)
  }

  /** Abort a running download; the installer wipes what it wrote. */
  cancel(modelId: string): boolean {
    const controller = this.#controllers.get(modelId)
    if (controller === undefined) return false
    controller.abort()
    return true
  }

  /** The job's final state — for callers that want to wait rather than poll. */
  whenSettled(modelId: string): Promise<ModelDownloadJob> {
    return this.#settled.get(modelId) ?? Promise.reject(new Error(`no download for "${modelId}"`))
  }
}

function snapshot(job: MutableJob): ModelDownloadJob {
  return { ...job }
}
