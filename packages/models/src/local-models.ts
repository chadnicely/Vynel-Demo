import type { LocalModelEntry, LocalModelSource } from '@vynel/contracts/models/local-model-catalog'
import { LOCAL_MODELS } from '@vynel/contracts/models/local-model-catalog'
import type {
  LocalModelState,
  LocalModelStatusResponse,
} from '@vynel/contracts/models/local-models-http'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { probeInstalledModel, removeInstalledModel } from './installed-model.js'
import type { ModelDownloadJob, ModelDownloadRunner } from './model-download-runner.js'

// The Settings screens' operations over the catalog: what state each model is
// in, start / cancel a download, remove. The app hands in WHERE each kind lives
// (two env-resolved directories) and any per-format hooks — the embedding
// model's remover must also forget the warm pipeline, which only
// `@vynel/embeddings` can do.

export interface LocalModelsDeps {
  /** Defaults to the whole catalog; tests hand in entries served locally. */
  readonly catalog?: readonly LocalModelEntry[]
  readonly baseDirFor: (entry: LocalModelEntry) => string
  readonly runner: ModelDownloadRunner
  readonly removers?: Partial<
    Record<LocalModelSource['format'], (entry: LocalModelEntry, baseDir: string) => Promise<void>>
  >
}

function catalogOf(deps: LocalModelsDeps): readonly LocalModelEntry[] {
  return deps.catalog ?? LOCAL_MODELS
}

function getCatalogEntryOrThrow(deps: LocalModelsDeps, modelId: string): LocalModelEntry {
  const entry = catalogOf(deps).find((row) => row.id === modelId)
  if (entry === undefined) throw new NotFoundError('local-model', modelId)
  return entry
}

// A running download wins over the disk (a half-written tree may already pass
// the probe); otherwise the disk wins over a stale failure (a model fetched
// after a failed attempt is installed, whatever the job says).
function deriveState(installed: boolean, job: ModelDownloadJob | null): LocalModelState {
  if (job?.status === 'downloading') return 'downloading'
  if (installed) return 'installed'
  if (job?.status === 'failed') return 'failed'
  return 'missing'
}

export async function describeLocalModel(
  deps: LocalModelsDeps,
  entry: LocalModelEntry,
): Promise<LocalModelStatusResponse> {
  const probe = await probeInstalledModel(deps.baseDirFor(entry), entry)
  const job = deps.runner.get(entry.id)
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    description: entry.description,
    approxBytes: entry.approxBytes,
    speakers: entry.speakers === undefined ? null : [...entry.speakers],
    state: deriveState(probe.installed, job),
    installedAt: probe.installedAt,
    download:
      job === null
        ? null
        : {
            bytes: job.bytes,
            total: job.total,
            error: job.error,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
          },
  }
}

export async function listLocalModelStatuses(
  deps: LocalModelsDeps,
): Promise<LocalModelStatusResponse[]> {
  return Promise.all(catalogOf(deps).map((entry) => describeLocalModel(deps, entry)))
}

/** Start fetching one model; the runner refuses a second start while one runs. */
export function startLocalModelDownload(deps: LocalModelsDeps, modelId: string): ModelDownloadJob {
  const entry = getCatalogEntryOrThrow(deps, modelId)
  return deps.runner.start(entry, deps.baseDirFor(entry))
}

export function cancelLocalModelDownload(deps: LocalModelsDeps, modelId: string): boolean {
  getCatalogEntryOrThrow(deps, modelId)
  return deps.runner.cancel(modelId)
}

export async function removeLocalModel(deps: LocalModelsDeps, modelId: string): Promise<void> {
  const entry = getCatalogEntryOrThrow(deps, modelId)
  if (deps.runner.get(modelId)?.status === 'downloading') {
    throw new ConflictError(`"${entry.label}" is downloading — cancel the download first.`)
  }
  const baseDir = deps.baseDirFor(entry)
  const remover = deps.removers?.[entry.source.format]
  if (remover !== undefined) await remover(entry, baseDir)
  else await removeInstalledModel(baseDir, entry)
}
