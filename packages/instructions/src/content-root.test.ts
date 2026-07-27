// The bundled-mode seam: packaged builds call setInstructionsContentRoot once
// at boot and every loader reads the shipped copy instead of the repo files.
// The loaders cache per-process, so the override test uses its own temp fixture
// and this file's module registry (vitest isolates modules per test file).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveInstructionsContentDirectory,
  setInstructionsContentRoot,
} from './content-root.js'
import { loadSessionInstruction } from './session-instructions/load-session-instruction.js'

describe('instructions content root', () => {
  afterEach(() => {
    setInstructionsContentRoot(undefined)
  })

  it('defaults to the package root content directories', () => {
    const directory = resolveInstructionsContentDirectory('session-instructions')
    expect(directory).toContain(join('packages', 'instructions', 'session-instructions'))
  })

  it('resolves against the override once set, and restores the default when cleared', () => {
    setInstructionsContentRoot(join(sep, 'shipped', 'instructions'))
    expect(resolveInstructionsContentDirectory('notebooks')).toBe(
      join(sep, 'shipped', 'instructions', 'notebooks'),
    )

    setInstructionsContentRoot(undefined)
    expect(resolveInstructionsContentDirectory('notebooks')).toContain(
      join('packages', 'instructions', 'notebooks'),
    )
  })

  it('loaders read from the override root (the packaged-build path)', () => {
    const root = mkdtempSync(join(tmpdir(), 'vynel-content-root-'))
    try {
      mkdirSync(join(root, 'session-instructions'))
      writeFileSync(
        join(root, 'session-instructions', 'global-root.md'),
        'shipped-copy prompt body',
      )
      setInstructionsContentRoot(root)
      expect(loadSessionInstruction('global-root')).toBe('shipped-copy prompt body')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
