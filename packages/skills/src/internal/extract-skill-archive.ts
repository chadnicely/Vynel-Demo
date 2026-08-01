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
import { readDeclaredUncompressedSize } from './read-declared-uncompressed-size.js'

const MAX_ENTRIES = 200
const MAX_SKILL_MARKDOWN_BYTES = 512 * 1024
// The hub's own artifact cap is 10 MB — anything larger can never be a
// legitimate published skill. Capping the compressed input BEFORE loadAsync
// is the first zip-bomb wall.
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024

// Unix mode type bits ride the zip's external attributes; S_IFLNK marks a
// symlink entry — written to disk it could point anywhere, so reject.
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

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
  if (name.includes('\\')) {
    throw new ValidationError(`The skill artifact entry '${name}' uses an unsafe path.`)
  }
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new ValidationError(`The skill artifact entry '${name}' uses an absolute path.`)
  }
  const segments = name.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ValidationError(`The skill artifact entry '${name}' traverses outside the skill folder.`)
  }
}

function isSymlinkEntry(entry: JSZip.JSZipObject): boolean {
  const mode = entry.unixPermissions
  return typeof mode === 'number' && (mode & S_IFMT) === S_IFLNK
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
  if (entries.length > MAX_ENTRIES) {
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
    if (isSymlinkEntry(entry)) {
      throw new ValidationError(`The skill artifact entry '${entry.name}' is a symlink.`)
    }
    const declaredSize = readDeclaredUncompressedSize(entry)
    if (declaredSize !== null && declaredSize > MAX_RESOURCE_BYTES) {
      throw new ValidationError(`The skill artifact entry '${entry.name}' exceeds the size limit.`)
    }
    const bytes = Buffer.from(await entry.async('nodebuffer'))
    if (bytes.byteLength > MAX_RESOURCE_BYTES) {
      throw new ValidationError(`The skill artifact entry '${entry.name}' exceeds the size limit.`)
    }
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ValidationError('The skill artifact inflates past the total size limit.')
    }
    resources.push({ relativePath: entry.name, bytes })
  }

  return { markdown, resources }
}
