import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalModelEntry } from '@vynel/contracts/models/local-model-catalog'
import { requiredModelFiles } from '@vynel/contracts/models/local-model-catalog'
import { downloadToFile, type DownloadProgress } from './download-to-file.js'
import { extractArchive } from './extract-archive.js'
import {
  modelInstallDir,
  probeInstalledModel,
  removeInstalledModel,
  writeModelStamp,
} from './installed-model.js'

/** Where Hugging Face Hub files resolve — the same URL shape transformers.js
 *  fetches, so what lands here is exactly what it would have cached. */
export const HF_HUB_BASE_URL = 'https://huggingface.co'

export interface InstallModelOptions {
  readonly onProgress?: (progress: DownloadProgress) => void
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
  readonly now?: () => Date
  /** Injectable for tests — the real one shells out to `tar`. */
  readonly extract?: (archiveName: string, targetDir: string) => Promise<void>
  /** Injectable for tests — a local server standing in for the Hub. */
  readonly hfHubBaseUrl?: string
}

// Fetch a model into `baseDir/<folder>`, verify every required file landed,
// and stamp it. Archives extract beside the folder; single files and Hub
// models are fetched file by file. The folder is wiped before AND on failure:
// a half-written tree must never be mistaken for a model (the embeddings
// cache taught us what a truncated file does to a native loader).
//
// Hub models are fetched HERE rather than left to transformers.js on first
// use: its own caching silently never engaged inside the engine (it checks
// `response instanceof Response`, and the HTTP server replaces that global),
// so the weights never reached the disk. One downloader, one set of files.
export async function installModelFromSource(
  baseDir: string,
  entry: LocalModelEntry,
  options: InstallModelOptions = {},
): Promise<void> {
  const source = entry.source
  const now = options.now ?? (() => new Date())
  const extract = options.extract ?? extractArchive
  const dir = modelInstallDir(baseDir, entry)

  await removeInstalledModel(baseDir, entry)
  await mkdir(baseDir, { recursive: true })
  try {
    if (source.format === 'archive') {
      // The archive unpacks to a top-level folder named like `entry.folder`.
      // It is extracted in a staging dir and renamed into place whole, so a
      // process killed mid-extract never leaves a half-populated model folder
      // that happens to contain the files the probe checks.
      const folderName = entry.folder.split('/').at(-1)!
      const archiveName = `${folderName}.tar.bz2`
      const stagingDir = join(baseDir, `.extracting-${folderName}`)
      await rm(stagingDir, { recursive: true, force: true })
      await mkdir(stagingDir, { recursive: true })
      try {
        await downloadToFile(source.url, join(stagingDir, archiveName), downloadOptions(options))
        await extract(archiveName, stagingDir)
        await rm(join(stagingDir, archiveName), { force: true })
        await rename(join(stagingDir, folderName), dir)
      } finally {
        await rm(stagingDir, { recursive: true, force: true })
      }
    } else if (source.format === 'file') {
      const [onlyFile] = requiredModelFiles(entry)
      if (onlyFile === undefined) throw new Error(`@vynel/models: "${entry.id}" lists no file to fetch.`)
      await downloadToFile(source.url, join(dir, ...onlyFile.split('/')), downloadOptions(options))
    } else {
      const hub = options.hfHubBaseUrl ?? HF_HUB_BASE_URL
      await downloadFilesInTurn(
        requiredModelFiles(entry).map((file) => ({
          url: `${hub}/${source.hfModelId}/resolve/main/${file}`,
          destination: join(dir, ...file.split('/')),
        })),
        options,
      )
    }

    const probe = await probeInstalledModel(baseDir, entry)
    if (!probe.installed) {
      throw new Error(
        `@vynel/models: the download of "${entry.id}" finished but ${probe.missingFile} is missing — the archive layout may have changed.`,
      )
    }
    await writeModelStamp(baseDir, entry, now())
  } catch (error) {
    await removeInstalledModel(baseDir, entry)
    throw error
  }
}

function downloadOptions(options: InstallModelOptions) {
  return {
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  }
}

// Several files, one bar: bytes accumulate across files; the total is left
// unknown (the caller keeps its catalog estimate) because each file's size is
// only learned as it starts.
async function downloadFilesInTurn(
  files: ReadonlyArray<{ url: string; destination: string }>,
  options: InstallModelOptions,
): Promise<void> {
  let doneBytes = 0
  for (const file of files) {
    let current = 0
    await downloadToFile(file.url, file.destination, {
      ...downloadOptions(options),
      onProgress: ({ bytes }) => {
        current = bytes
        options.onProgress?.({ bytes: doneBytes + current, total: null })
      },
    })
    doneBytes += current
  }
}
