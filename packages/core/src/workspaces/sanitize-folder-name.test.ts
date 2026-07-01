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
})
