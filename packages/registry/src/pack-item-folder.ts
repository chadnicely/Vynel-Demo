// Turn an on-disk item folder into the artifact zip the hub stores — the one
// packing home shared by the anthropic import, the publish-from-repo
// pipeline, and the operator CLI. Kind-aware: each catalog kind proves
// itself with its entry file at the folder root (the seed-bundle layout);
// `vynel-item.json` (bundle metadata, not artifact content) and any `.git`
// directory never ride along.

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import JSZip from 'jszip'
import { ValidationError } from '@vynel/errors'

export const ITEM_METADATA_FILE = 'vynel-item.json'

/** The file that must sit at the folder root for each publishable kind. */
export const ENTRY_FILE_BY_KIND = {
  skill: 'SKILL.md',
  agent: 'agent.json',
  mcp: 'server-descriptor.json',
  rule: 'rule-descriptor.json',
  plugin: 'delegate-descriptor.json',
} as const

export type PackableItemKind = keyof typeof ENTRY_FILE_BY_KIND

async function listFilesRecursively(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    // A symlink here would be DEREFERENCED by the readFile below — a hostile
    // repo could link to server files (/etc/passwd, key material) and ship
    // their bytes inside a hub-signed artifact. The zip-level symlink wall
    // runs downstream on the already-packed bytes, so it can never see this.
    if (entry.isSymbolicLink()) {
      throw new ValidationError(
        `${join(relative(base, dir), entry.name)} is a symlink — folders with symlinks are not publishable.`,
      )
    }
    if (entry.isDirectory()) out.push(...(await listFilesRecursively(full, base)))
    else out.push(relative(base, full))
  }
  return out
}

function isPackable(relativePath: string): boolean {
  const segments = relativePath.split(sep)
  if (segments.includes('.git')) return false
  return relativePath !== ITEM_METADATA_FILE
}

/** Zip an item folder faithfully — every file, forward-slash paths, DEFLATE —
 *  minus the metadata file and any `.git`. Refuses a folder without the
 *  kind's root entry file (not a publishable folder of that kind). */
export async function packItemFolder(folder: string, kind: PackableItemKind): Promise<Buffer> {
  const entryFile = ENTRY_FILE_BY_KIND[kind]
  const files = (await listFilesRecursively(folder)).filter(isPackable)
  if (!files.includes(entryFile)) {
    throw new ValidationError(
      `${folder} has no root ${entryFile} — not a publishable ${kind} folder.`,
    )
  }
  const zip = new JSZip()
  for (const relativePath of files) {
    zip.file(relativePath.split(sep).join('/'), await readFile(join(folder, relativePath)))
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
