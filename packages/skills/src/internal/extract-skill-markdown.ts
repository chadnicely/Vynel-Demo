// Reads SKILL.md out of a downloaded skill artifact (zip). v1 installs a
// single-file skill: we read ONLY the SKILL.md entry and never write arbitrary
// archive paths to disk, so classic zip-slip (path traversal on extraction) is
// not a vector here — the guards below are defense-in-depth + a zip-bomb cap.
//
// SECURITY ORDERING (enforced by the caller): the artifact's sha256 is verified
// against the catalog's recorded hash BEFORE this runs, so we only ever parse
// bytes the hub vouched for. Multi-file skill bundles (a future extension) must
// add full per-entry traversal/absolute/symlink guards before writing to disk.

import JSZip from 'jszip'
import { ValidationError } from '@vynel/errors'

const MAX_ENTRIES = 200
const MAX_SKILL_MARKDOWN_BYTES = 512 * 1024

export async function extractSkillMarkdown(artifact: Buffer): Promise<string> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(artifact)
  } catch {
    throw new ValidationError('The downloaded skill artifact is not a valid archive.')
  }

  if (Object.keys(zip.files).length > MAX_ENTRIES) {
    throw new ValidationError('The skill artifact has too many entries.')
  }

  // SKILL.md must sit at the archive root, by convention.
  const entry = zip.file('SKILL.md')
  if (entry === null) {
    throw new ValidationError('The skill artifact is missing SKILL.md.')
  }

  const markdown = await entry.async('string')
  if (Buffer.byteLength(markdown, 'utf8') > MAX_SKILL_MARKDOWN_BYTES) {
    throw new ValidationError('SKILL.md exceeds the size limit.')
  }
  return markdown
}
