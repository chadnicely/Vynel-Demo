// Pins the `shell: true` quoting rule. The regression this exists for:
// `pnpm test` died in check-mcp-parity because the repo path
// `C:\Users\chad\Development\Claude Code\vynel` split at the space and node
// tried to load `C:\Users\chad\Development\Claude`.

import { describe, it, expect } from 'vitest'
import { quoteArgsForShell, quoteForShell } from './quote-for-shell.js'

describe('quoteForShell', () => {
  it('quotes a path containing a space', () => {
    expect(quoteForShell('C:\\Users\\chad\\Development\\Claude Code\\vynel\\a.ts')).toBe(
      '"C:\\Users\\chad\\Development\\Claude Code\\vynel\\a.ts"',
    )
  })

  it('leaves a space-free argument alone', () => {
    expect(quoteForShell('--dry-run')).toBe('--dry-run')
    expect(quoteForShell('C:\\src\\vynel\\a.ts')).toBe('C:\\src\\vynel\\a.ts')
  })

  it('never double-quotes an argument that is already quoted', () => {
    expect(quoteForShell('"C:\\Claude Code\\a.ts"')).toBe('"C:\\Claude Code\\a.ts"')
  })

  it('handles more than one space', () => {
    expect(quoteForShell('/a b/c d/e.ts')).toBe('"/a b/c d/e.ts"')
  })
})

describe('quoteArgsForShell', () => {
  it('quotes only the arguments that need it', () => {
    expect(
      quoteArgsForShell(['node', '/Claude Code/bin.js', '--platform=win32', '/plain/path.js']),
    ).toEqual(['node', '"/Claude Code/bin.js"', '--platform=win32', '/plain/path.js'])
  })

  it('an empty argv is left empty', () => {
    expect(quoteArgsForShell([])).toEqual([])
  })
})
