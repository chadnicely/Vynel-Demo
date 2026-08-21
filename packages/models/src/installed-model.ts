import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalModelEntry } from '@vynel/contracts/models/local-model-catalog'
import { requiredModelFiles } from '@vynel/contracts/models/local-model-catalog'

// What is on the disk for one catalog entry. "Installed" means every required
// file is there — the same check the loaders make before touching the native
// runtime. The stamp is metadata Vynel writes after its own download (when it
// was installed); models fetched by hand or by transformers.js have none and
// still count, so a dev's existing `.models/` keeps working.

export const MODEL_STAMP_FILE = '.vynel-model.json'

export interface InstalledModelStamp {
  readonly id: string
  readonly installedAt: string
}

export interface InstalledModelProbe {
  readonly installed: boolean
  /** The first required path that is missing — what to say when it isn't. */
  readonly missingFile: string | null
  /** From the stamp, when Vynel did the download itself. */
  readonly installedAt: string | null
}

export function modelInstallDir(baseDir: string, entry: LocalModelEntry): string {
  return join(baseDir, ...entry.folder.split('/'))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function probeInstalledModel(
  baseDir: string,
  entry: LocalModelEntry,
): Promise<InstalledModelProbe> {
  const dir = modelInstallDir(baseDir, entry)
  for (const relative of requiredModelFiles(entry)) {
    const path = join(dir, ...relative.split('/'))
    if (!(await exists(path))) return { installed: false, missingFile: path, installedAt: null }
  }
  return { installed: true, missingFile: null, installedAt: await readStampInstalledAt(dir) }
}

async function readStampInstalledAt(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dir, MODEL_STAMP_FILE), 'utf8')
    const stamp = JSON.parse(raw) as Partial<InstalledModelStamp>
    return typeof stamp.installedAt === 'string' ? stamp.installedAt : null
  } catch {
    // No stamp, or a stamp we cannot read: the files decide, not the note.
    return null
  }
}

export async function writeModelStamp(
  baseDir: string,
  entry: LocalModelEntry,
  installedAt: Date,
): Promise<void> {
  const dir = modelInstallDir(baseDir, entry)
  await mkdir(dir, { recursive: true })
  const stamp: InstalledModelStamp = { id: entry.id, installedAt: installedAt.toISOString() }
  await writeFile(join(dir, MODEL_STAMP_FILE), JSON.stringify(stamp, null, 2))
}

/** Remove the model's folder entirely — also how a half-written one is cleared. */
export async function removeInstalledModel(baseDir: string, entry: LocalModelEntry): Promise<void> {
  await rm(modelInstallDir(baseDir, entry), { recursive: true, force: true })
}
