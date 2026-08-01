import { describe, it, expect } from 'vitest'
import {
  MAX_ARTIFACT_BYTES,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES,
  archiveEntryPathViolation,
  isSymlinkUnixMode,
} from './artifact-archive-rules.js'

describe('archiveEntryPathViolation', () => {
  it('accepts plain relative forward-slash paths', () => {
    expect(archiveEntryPathViolation('SKILL.md')).toBeNull()
    expect(archiveEntryPathViolation('assets/fonts/Arsenal.ttf')).toBeNull()
    expect(archiveEntryPathViolation('a.b/c-d_e.txt')).toBeNull()
  })

  it('refuses backslashes, absolute paths, and drive letters', () => {
    expect(archiveEntryPathViolation('a\\b.txt')).toBe('uses an unsafe path')
    expect(archiveEntryPathViolation('/etc/evil')).toBe('uses an absolute path')
    expect(archiveEntryPathViolation('C:/evil')).toBe('uses an absolute path')
  })

  it('refuses traversal and degenerate segments', () => {
    expect(archiveEntryPathViolation('../evil.txt')).toBe('traverses outside the archive root')
    expect(archiveEntryPathViolation('a/../b')).toBe('traverses outside the archive root')
    expect(archiveEntryPathViolation('a/./b')).toBe('traverses outside the archive root')
    expect(archiveEntryPathViolation('a//b')).toBe('traverses outside the archive root')
  })
})

describe('isSymlinkUnixMode', () => {
  it('detects the S_IFLNK type bits and nothing else', () => {
    expect(isSymlinkUnixMode(0o120755)).toBe(true)
    expect(isSymlinkUnixMode(0o100644)).toBe(false)
    expect(isSymlinkUnixMode(null)).toBe(false)
    expect(isSymlinkUnixMode(undefined)).toBe(false)
  })
})

describe('caps', () => {
  it('keeps the entry and total caps inside the artifact story (8MB < 10MB compressed < 32MB total)', () => {
    expect(MAX_ARCHIVE_ENTRY_BYTES).toBeLessThan(MAX_ARTIFACT_BYTES)
    expect(MAX_ARTIFACT_BYTES).toBeLessThan(MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES)
  })
})
