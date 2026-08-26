import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ensureWorkspaceMetadataDirectory } from './ensure-workspace-metadata-directory.js'

describe('ensureWorkspaceMetadataDirectory', () => {
  it('creates .vynel and reports the created path — the caller\'s take-back handle', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'vynel-meta-'))
    const created = await ensureWorkspaceMetadataDirectory(folder)
    expect(created).toBe(path.join(folder, '.vynel'))
    expect(existsSync(path.join(folder, '.vynel'))).toBe(true)
  })

  it('is idempotent: reports null for an existing dir and leaves its contents alone', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'vynel-meta-'))
    await ensureWorkspaceMetadataDirectory(folder)
    writeFileSync(path.join(folder, '.vynel', 'note.txt'), 'kept\n')
    const created = await ensureWorkspaceMetadataDirectory(folder)
    expect(created).toBeNull()
    expect(readFileSync(path.join(folder, '.vynel', 'note.txt'), 'utf8')).toBe('kept\n')
  })
})
