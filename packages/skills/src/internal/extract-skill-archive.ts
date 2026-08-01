// Extracts a verified skill artifact (zip) into SKILL.md + its resource
// entries — the multi-file extension `extract-skill-markdown.ts`'s header
// reserved (official skills ship fonts, theme packs, and helper scripts
// alongside SKILL.md; a markdown-only install ships them broken).
//
// SECURITY ORDERING (enforced by the caller): the artifact's sha256 is
// verified against the catalog's recorded hash BEFORE this runs, so we only
// ever parse bytes the hub vouched for. Because these entries ARE written to
// disk, every entry passes the full wall: no absolute paths, no drive
// letters, no `.`/`..` segments, no backslashes, no symlinks — plus the
// zip-bomb caps (compressed input, entry count, per-entry and cumulative
// uncompressed size, declared-size pre-checks with post-inflate backstops).

import JSZip from 'jszip'
import { ValidationError } from '@vynel/errors'
// The caps and path/symlink rules are SHARED with the hub's publish-time
// inspection (`@vynel/registry`) through the contracts home — the desktop's
// write wall and the hub's door wall can never drift.
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ARTIFACT_BYTES,
  archiveEntryPathViolation,
  isSymlinkUnixMode,
} from '@vynel/contracts/hub/artifact-archive-rules'
import { readDeclaredUncompressedSize } from './read-declared-uncompressed-size.js'

const MAX_SKILL_MARKDOWN_BYTES = 512 * 1024

export type SkillArchiveResource = {
  /** Forward-slash relative path inside the skill folder (validated safe). */
  relativePath: string
  bytes: Buffer
}

export type SkillArchive = {
  markdown: string
  resources: SkillArchiveResource[]
}

function assertSafeRelativePath(name: string): void {
  const violation = archiveEntryPathViolation(name)
  if (violation !== null) {
    throw new ValidationError(`The skill artifact entry '${name}' ${violation}.`)
  }
}

export async function extractSkillArchive(artifact: Buffer): Promise<SkillArchive> {
  if (artifact.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ValidationError('The downloaded skill artifact exceeds the size limit.')
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(artifact)
  } catch {
    throw new ValidationError('The downloaded skill artifact is not a valid archive.')
  }

  const entries = Object.values(zip.files)
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ValidationError('The skill artifact has too many entries.')
  }

  // SKILL.md must sit at the archive root, by convention.
  const markdownEntry = zip.file('SKILL.md')
  if (markdownEntry === null) {
    throw new ValidationError('The skill artifact is missing SKILL.md.')
  }
  const declaredMarkdownSize = readDeclaredUncompressedSize(markdownEntry)
  if (declaredMarkdownSize !== null && declaredMarkdownSize > MAX_SKILL_MARKDOWN_BYTES) {
    throw new ValidationError('SKILL.md exceeds the size limit.')
  }
  const markdown = await markdownEntry.async('string')
  if (Buffer.byteLength(markdown, 'utf8') > MAX_SKILL_MARKDOWN_BYTES) {
    throw new ValidationError('SKILL.md exceeds the size limit.')
  }

  const resources: SkillArchiveResource[] = []
  let totalBytes = Buffer.byteLength(markdown, 'utf8')
  // Case-insensitive collision wall: on Windows/macOS default filesystems a
  // `skill.md` "resource" would overwrite the just-written SKILL.md (and
  // sidestep its tighter size cap); case-variant duplicates would silently
  // last-write-win. Seed with SKILL.md so any root variant collides.
  const seenPathsFolded = new Set(['skill.md'])
  for (const entry of entries) {
    if (entry.dir || entry.name === 'SKILL.md') continue
    assertSafeRelativePath(entry.name)
    const folded = entry.name.toLowerCase()
    if (seenPathsFolded.has(folded)) {
      throw new ValidationError(
        `The skill artifact entry '${entry.name}' collides with another entry (case-insensitive).`,
      )
    }
    seenPathsFolded.add(folded)
    if (isSymlinkUnixMode(entry.unixPermissions)) {
      throw new ValidationError(`The skill artifact entry '${entry.name}' is a symlink.`)
    }
    const declaredSize = readDeclaredUncompressedSize(entry)
    if (declaredSize !== null && declaredSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new ValidationError(`The skill artifact entry '${entry.name}' exceeds the size limit.`)
    }
    const bytes = Buffer.from(await entry.async('nodebuffer'))
    if (bytes.byteLength > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new ValidationError(`The skill artifact entry '${entry.name}' exceeds the size limit.`)
    }
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ValidationError('The skill artifact inflates past the total size limit.')
    }
    resources.push({ relativePath: entry.name, bytes })
  }

  return { markdown, resources }
}
