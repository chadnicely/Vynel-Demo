import { describe, it, expect } from 'vitest'
import { sanitizeFolderName } from './sanitize-folder-name.js'

describe('sanitizeFolderName', () => {
  it('replaces filesystem-unsafe characters with underscore', () => {
    expect(sanitizeFolderName('My<>:Workspace')).toBe('My___Workspace')
  })

  it('replaces path separators and control chars', () => {
    expect(sanitizeFolderName('a/b\\c')).toBe('a_b_c')
  })

  it('trims, and falls back to "workspace" when nothing usable remains', () => {
    expect(sanitizeFolderName('  Acme  ')).toBe('Acme')
    expect(sanitizeFolderName('   ')).toBe('workspace')
    expect(sanitizeFolderName('')).toBe('workspace')
  })

  // A traversal is never a folder NAME — a minted project must land INSIDE the
  // home, never at it (`.`) or above it (`..`).
  it('refuses a traversal — "." and ".." fall back to "workspace"', () => {
    expect(sanitizeFolderName('.')).toBe('workspace')
    expect(sanitizeFolderName('..')).toBe('workspace')
    expect(sanitizeFolderName('  ..  ')).toBe('workspace')
  })

  it('keeps a name that merely CONTAINS dots', () => {
    expect(sanitizeFolderName('my.app')).toBe('my.app')
    expect(sanitizeFolderName('v1.2')).toBe('v1.2')
  })
})
