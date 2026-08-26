import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureDefaultWorkspaceParentDirectory } from './ensure-default-workspace-parent-directory.js'

describe('ensureDefaultWorkspaceParentDirectory', () => {
  it('creates the projects home if it is missing and returns its path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vynel-home-'))
    const home = path.join(root, 'Documents', 'Vynel')
    try {
      expect(existsSync(home)).toBe(false)
      const resolved = await ensureDefaultWorkspaceParentDirectory(() => home)
      expect(resolved).toBe(home)
      expect(existsSync(home)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is idempotent — an existing home is a no-op', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'vynel-home-'))
    try {
      const resolved = await ensureDefaultWorkspaceParentDirectory(() => home)
      expect(resolved).toBe(home)
      expect(existsSync(home)).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
