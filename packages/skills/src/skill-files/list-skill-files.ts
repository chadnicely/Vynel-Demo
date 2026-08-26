// Reads a skill folder as the editor sees it: every file under the folder,
// relative forward-slash paths, size, and whether it is TEXT the editor can
// open (a binary asset — an image a skill ships — is listed but never
// opened). Files the path wall would refuse to write (hidden names, too
// deep) are left out so the list only ever shows what the doors can reach.

import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import type { InstalledSkillRow } from '../repositories/index.js'
import { resolveInstalledSkillFolder } from '../internal/resolve-installed-skill-folder.js'
import { MAX_SKILL_FILE_DEPTH, SKILL_ENTRY_FILE } from './assert-safe-skill-file-path.js'

/** The most a file may weigh and still open in the text editor. */
export const MAX_SKILL_TEXT_FILE_BYTES = 1024 * 1024

/** The classic binary tell — a NUL byte — is looked for in this much. */
export const TEXT_SNIFF_BYTES = 8192

export type SkillFileEntry = {
  /** Forward-slash path relative to the skill folder. */
  relativePath: string
  sizeBytes: number
  isText: boolean
}

export function listSkillFiles(
  installedSkill: Pick<InstalledSkillRow, 'skillId' | 'scope' | 'installLocation'>,
  workspacePath?: string,
): SkillFileEntry[] {
  const skillFolder = resolveInstalledSkillFolder(installedSkill, workspacePath)
  const entries: SkillFileEntry[] = []
  collectSkillFiles(skillFolder, '', 1, entries)
  // SKILL.md first — it is the file the editor opens by default.
  return entries.sort((a, b) => {
    if (a.relativePath === SKILL_ENTRY_FILE) return -1
    if (b.relativePath === SKILL_ENTRY_FILE) return 1
    return a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0
  })
}

/** True when the first bytes carry no NUL — everything else opens as UTF-8
 *  text (a wrongly guessed encoding shows as mojibake, never as a crash). */
export function looksLikeTextFile(absolutePath: string, sizeBytes: number): boolean {
  if (sizeBytes === 0) return true
  let handle: number | null = null
  try {
    handle = openSync(absolutePath, 'r')
    const sample = Buffer.alloc(Math.min(TEXT_SNIFF_BYTES, sizeBytes))
    const read = readSync(handle, sample, 0, sample.length, 0)
    return !sample.subarray(0, read).includes(0)
  } catch {
    return false
  } finally {
    if (handle !== null) closeSync(handle)
  }
}

function collectSkillFiles(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  out: SkillFileEntry[],
): void {
  if (depth > MAX_SKILL_FILE_DEPTH) return
  let names: string[]
  try {
    names = readdirSync(absoluteDir)
  } catch {
    return
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const absolutePath = path.join(absoluteDir, name)
    const relativePath = relativeDir === '' ? name : `${relativeDir}/${name}`
    let stats
    try {
      stats = statSync(absolutePath)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      collectSkillFiles(absolutePath, relativePath, depth + 1, out)
      continue
    }
    if (!stats.isFile()) continue
    out.push({
      relativePath,
      sizeBytes: stats.size,
      isText: stats.size <= MAX_SKILL_TEXT_FILE_BYTES && looksLikeTextFile(absolutePath, stats.size),
    })
  }
}
