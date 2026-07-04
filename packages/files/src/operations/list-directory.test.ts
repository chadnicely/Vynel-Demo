// Integration tests for listDirectory. Real temp workspace dir + real
// SQLite via withTestDatabase. Per the no-DB-mocking rule.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listDirectory } from './list-directory.js'
import { seedUserAndWorkspace } from '../_test-helpers.js'

describe('listDirectory', () => {
  it('returns an empty array for an empty workspace root', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      const entries = await listDirectory({ workspacePath, relativePath: '' })
      expect(entries).toEqual([])
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('lists files + directories with dirs-first then alpha sort', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'todo.md'), '# Todo\n')
      await writeFile(path.join(workspacePath, 'notes.txt'), 'hi\n')
      await mkdir(path.join(workspacePath, 'projects'))
      await mkdir(path.join(workspacePath, 'archive'))

      const entries = await listDirectory({ workspacePath, relativePath: '' })

      // Directories first (alpha), then files (alpha).
      expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
        'directory:archive',
        'directory:projects',
        'file:notes.txt',
        'file:todo.md',
      ])
      const todo = entries.find((e) => e.name === 'todo.md')!
      expect(todo.relativePath).toBe('todo.md')
      expect(todo.fileSizeBytes).toBeGreaterThan(0)
      expect(todo.modifiedAt).toBeInstanceOf(Date)

      const archive = entries.find((e) => e.name === 'archive')!
      expect(archive.fileSizeBytes).toBeNull()

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('reports childCount for directories (hidden filter applied) and null for files', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, 'projects'))
      await writeFile(path.join(workspacePath, 'projects', 'a.md'), 'a\n')
      await writeFile(path.join(workspacePath, 'projects', 'b.md'), 'b\n')
      // A hidden entry inside the folder — excluded from the default count.
      await writeFile(path.join(workspacePath, 'projects', '.secret'), 'x\n')
      await writeFile(path.join(workspacePath, 'todo.md'), '# Todo\n')

      const entries = await listDirectory({ workspacePath, relativePath: '' })
      const projects = entries.find((e) => e.name === 'projects')!
      const todo = entries.find((e) => e.name === 'todo.md')!
      // Two visible children (the dotfile is hidden by default).
      expect(projects.childCount).toBe(2)
      // Files carry no child count.
      expect(todo.childCount).toBeNull()

      // includeHidden counts the dotfile too.
      const all = await listDirectory({ workspacePath, relativePath: '', includeHidden: true })
      expect(all.find((e) => e.name === 'projects')!.childCount).toBe(3)

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("hides .vynel/, node_modules/, .git/ and dotfiles by default", async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, '.vynel'))
      await mkdir(path.join(workspacePath, 'node_modules'))
      await mkdir(path.join(workspacePath, '.git'))
      await writeFile(path.join(workspacePath, '.gitignore'), '*.log\n')
      await writeFile(path.join(workspacePath, 'visible.md'), '#\n')

      const visible = await listDirectory({ workspacePath, relativePath: '' })
      expect(visible.map((e) => e.name)).toEqual(['visible.md'])

      const all = await listDirectory({ workspacePath, relativePath: '', includeHidden: true })
      expect(all.map((e) => e.name).sort()).toEqual([
        '.git',
        '.gitignore',
        '.vynel',
        'node_modules',
        'visible.md',
      ])

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('lists a nested directory via its relativePath', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, 'projects'))
      await writeFile(path.join(workspacePath, 'projects', 'plan.md'), 'x\n')

      const entries = await listDirectory({ workspacePath, relativePath: 'projects' })
      expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual(['file:plan.md'])
      expect(entries[0]?.relativePath).toBe('projects/plan.md')

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('rejects a `..` escape via the path-safety helper', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        listDirectory({ workspacePath, relativePath: '../escape' }),
      ).rejects.toThrow(/outside the workspace/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('throws NotFoundError for a missing directory', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        listDirectory({ workspacePath, relativePath: 'does-not-exist' }),
      ).rejects.toThrow(/not found/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})
