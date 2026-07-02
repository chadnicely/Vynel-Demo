import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { listKnowledgeDocumentsForWorkspace } from '../repositories/index.js'
import { indexSource } from './index-workspace.js'
import { seedUserWorkspaceAndSource } from '../_test-helpers.js'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-knowledge-walk-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('indexWorkspace', () => {
  it('walks the workspace, indexes eligible files, returns accurate counts', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, source } = seedUserWorkspaceAndSource(db, workspacePath)
      // 3 eligible files (2 markdown + 1 plain-text), 1 skipped
      // (unsupported), 1 skipped folder (Archive)
      await mkdir(path.join(workspacePath, 'Notes'), { recursive: true })
      await mkdir(path.join(workspacePath, 'Archive'), { recursive: true })
      await writeFile(path.join(workspacePath, 'README.md'), '# Hi', 'utf8')
      await writeFile(path.join(workspacePath, 'Notes', 'a.md'), '# A', 'utf8')
      await writeFile(path.join(workspacePath, 'Notes', 'b.txt'), 'plain', 'utf8')
      await writeFile(path.join(workspacePath, 'logo.png'), 'binary', 'utf8')
      await writeFile(path.join(workspacePath, 'Archive', 'old.md'), 'old', 'utf8')

      const result = await indexSource(db, source)

      expect(result.indexedCount).toBe(3)
      expect(result.skippedCount).toBe(1)
      expect(result.failedCount).toBe(0)

      const allDocs = listKnowledgeDocumentsForWorkspace(db, workspace.id, { limit: 200 })
      expect(allDocs).toHaveLength(4) // 3 indexed + 1 skipped (unsupported); Archive never walked
      const parsedPaths = new Set(
        allDocs.filter((d) => d.parseStatus === 'parsed').map((d) => d.relativePath),
      )
      expect(parsedPaths).toEqual(new Set(['README.md', 'Notes/a.md', 'Notes/b.txt']))
    })
  })

  it('skips dotfiles + node_modules + .vynel/ + Archive/ subtrees', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, source } = seedUserWorkspaceAndSource(db, workspacePath)
      await mkdir(path.join(workspacePath, '.vynel'), { recursive: true })
      await mkdir(path.join(workspacePath, 'node_modules', 'foo'), { recursive: true })
      await mkdir(path.join(workspacePath, 'Archive', 'sub'), { recursive: true })
      await writeFile(path.join(workspacePath, '.hidden.md'), 'h', 'utf8')
      await writeFile(path.join(workspacePath, '.vynel', 'state.md'), 's', 'utf8')
      await writeFile(path.join(workspacePath, 'node_modules', 'foo', 'pkg.md'), 'p', 'utf8')
      await writeFile(path.join(workspacePath, 'Archive', 'sub', 'old.md'), 'o', 'utf8')
      await writeFile(path.join(workspacePath, 'visible.md'), 'v', 'utf8')

      const result = await indexSource(db, source)

      expect(result.indexedCount).toBe(1) // only visible.md
      expect(result.skippedCount).toBe(0)
      expect(result.failedCount).toBe(0)
    })
  })

  it('indexes USER/PREFERENCES/MEMORY.md at the root as ordinary documents', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, source } = seedUserWorkspaceAndSource(db, workspacePath)
      await writeFile(path.join(workspacePath, 'USER.md'), '# Me', 'utf8')
      await writeFile(path.join(workspacePath, 'PREFERENCES.md'), '# Prefs', 'utf8')
      await writeFile(path.join(workspacePath, 'MEMORY.md'), '# Memory', 'utf8')

      const result = await indexSource(db, source)

      // Reserved names get no special treatment post-A3 — they index like any file.
      expect(result.indexedCount).toBe(3)
      const docs = listKnowledgeDocumentsForWorkspace(db, workspace.id, { limit: 50 })
      expect(docs.every((d) => d.parseStatus === 'parsed')).toBe(true)
    })
  })

  it('returns all-zero counts for an empty workspace', async () => {
    await withTestDatabase(async (db) => {
      const { workspace, source } = seedUserWorkspaceAndSource(db, workspacePath)
      const result = await indexSource(db, source)
      expect(result).toEqual({ indexedCount: 0, skippedCount: 0, failedCount: 0 })
    })
  })
})
