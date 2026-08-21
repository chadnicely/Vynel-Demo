import { mkdir, rm } from 'node:fs/promises'
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

export interface InstallModelOptions {
  readonly onProgress?: (progress: DownloadProgress) => void
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
  readonly now?: () => Date
  /** Injectable for tests — the real one shells out to `tar`. */
  readonly extract?: (archiveName: string, targetDir: string) => Promise<void>
}

// Fetch an archive or single-file model into `baseDir/<folder>`, verify every
// required file landed, and stamp it. The folder is wiped before AND on failure:
// a half-extracted tree must never be mistaken for a model (the embeddings
// cache taught us what a truncated file does to a native loader).
export async function installModelFromSource(
  baseDir: string,
  entry: LocalModelEntry,
  options: InstallModelOptions = {},
): Promise<void> {
  const source = entry.source
  if (source.format === 'hf-hub') {
    throw new Error(
      `@vynel/models: "${entry.id}" is fetched by transformers.js — install it through the hf-hub installer, not from a URL.`,
    )
  }
  const now = options.now ?? (() => new Date())
  const extract = options.extract ?? extractArchive
  const downloadOptions = {
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  }

  await removeInstalledModel(baseDir, entry)
  await mkdir(baseDir, { recursive: true })
  try {
    if (source.format === 'archive') {
      // The archive unpacks to a top-level folder named like `entry.folder`.
      const archiveName = `${entry.folder.split('/').at(-1)}.tar.bz2`
      const archivePath = join(baseDir, archiveName)
      try {
        await downloadToFile(source.url, archivePath, downloadOptions)
        await extract(archiveName, baseDir)
      } finally {
        await rm(archivePath, { force: true })
      }
    } else {
      const [onlyFile] = requiredModelFiles(entry)
      if (onlyFile === undefined) throw new Error(`@vynel/models: "${entry.id}" lists no file to fetch.`)
      await downloadToFile(
        source.url,
        join(modelInstallDir(baseDir, entry), ...onlyFile.split('/')),
        downloadOptions,
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
