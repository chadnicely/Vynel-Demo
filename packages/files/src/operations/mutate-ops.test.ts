// Integration tests for the 5 core mutate ops. Each test asserts BOTH
// the filesystem effect AND the file_activities row (with editor:
// 'self'). Real temp workspace dir + real SQLite.

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listFileActivitiesForWorkspace } from '@vynel/db/repositories/files'
import { writeFileContent } from './write-file-content.js'
import { createFile } from './create-file.js'
import { createDirectory } from './create-directory.js'
import { moveEntry } from './move-entry.js'
import { deleteEntry } from './delete-entry.js'
import { MAX_EDITABLE_BYTES } from './file-content-kind.js'
import { seedUserAndWorkspace } from '../_test-helpers.js'

describe('writeFileContent', () => {
  it("writes a new file and records 'file-created' with editor='self'", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      const result = await writeFileContent(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'notes/todo.md',
        content: '# Todo\n- ship files',
      })
      expect(result.wasCreated).toBe(true)
      expect(result.relativePath).toBe('notes/todo.md')

      const onDisk = await readFile(path.join(workspacePath, 'notes', 'todo.md'), 'utf8')
      expect(onDisk).toContain('ship files')

      const activity = listFileActivitiesForWorkspace(db, workspaceId)
      expect(activity).toHaveLength(1)
      expect(activity[0]?.activityKind).toBe('file-created')
      expect(activity[0]?.editor).toBe('self')
      expect(activity[0]?.relativePath).toBe('notes/todo.md')
      expect(activity[0]?.fileSizeBytes).toBeGreaterThan(0)

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("records 'file-edited' when the file already existed", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'doc.md'), 'old', 'utf8')
      const result = await writeFileContent(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'doc.md',
        content: 'new',
      })
      expect(result.wasCreated).toBe(false)
      expect(await readFile(path.join(workspacePath, 'doc.md'), 'utf8')).toBe('new')

      const activity = listFileActivitiesForWorkspace(db, workspaceId)
      expect(activity[0]?.activityKind).toBe('file-edited')
      expect(activity[0]?.editor).toBe('self')

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('rejects writes that escape the workspace', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        writeFileContent(db, {
          userId,
          workspaceId,
          workspacePath,
          relativePath: '../escape.txt',
          content: 'x',
        }),
      ).rejects.toThrow(/outside the workspace/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('rejects writes targeting .vynel/', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        writeFileContent(db, {
          userId,
          workspaceId,
          workspacePath,
          relativePath: '.vynel/state.json',
          content: '{}',
        }),
      ).rejects.toThrow(/reserved by Vynel/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('rejects content over MAX_EDITABLE_BYTES', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        writeFileContent(db, {
          userId,
          workspaceId,
          workspacePath,
          relativePath: 'huge.txt',
          content: 'a'.repeat(MAX_EDITABLE_BYTES + 1),
        }),
      ).rejects.toThrow(/too large to edit/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('creates the parent directory if it does not exist', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFileContent(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'deeply/nested/new.md',
        content: 'x',
      })
      const s = await stat(path.join(workspacePath, 'deeply', 'nested', 'new.md'))
      expect(s.isFile()).toBe(true)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})

describe('createFile', () => {
  it("creates an empty file by default + records 'file-created'", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await createFile(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'fresh.md',
      })
      const onDisk = await readFile(path.join(workspacePath, 'fresh.md'), 'utf8')
      expect(onDisk).toBe('')
      const activity = listFileActivitiesForWorkspace(db, workspaceId)
      expect(activity[0]?.activityKind).toBe('file-created')
      expect(activity[0]?.editor).toBe('self')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('seeds with the supplied content', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await createFile(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'seeded.md',
        content: '# Hello',
      })
      expect(await readFile(path.join(workspacePath, 'seeded.md'), 'utf8')).toBe('# Hello')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('refuses to overwrite an existing file (ConflictError)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'taken.md'), 'old', 'utf8')
      await expect(
        createFile(db, {
          userId,
          workspaceId,
          workspacePath,
          relativePath: 'taken.md',
          content: 'new',
        }),
      ).rejects.toThrow(/already exists/i)
      // Original content survives.
      expect(await readFile(path.join(workspacePath, 'taken.md'), 'utf8')).toBe('old')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})

describe('createDirectory', () => {
  it("creates a new dir + records 'folder-created'", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      const result = await createDirectory(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'projects/q3',
      })
      expect(result.wasCreated).toBe(true)
      const s = await stat(path.join(workspacePath, 'projects', 'q3'))
      expect(s.isDirectory()).toBe(true)
      const activity = listFileActivitiesForWorkspace(db, workspaceId)
      expect(activity[0]?.activityKind).toBe('folder-created')
      expect(activity[0]?.editor).toBe('self')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('is idempotent on an existing dir (no activity row, wasCreated=false)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, 'already'))
      const result = await createDirectory(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'already',
      })
      expect(result.wasCreated).toBe(false)
      expect(listFileActivitiesForWorkspace(db, workspaceId)).toEqual([])
      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})

describe('moveEntry', () => {
  it("renames a file within the same parent + records 'file-moved' with fromPath", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'old.md'), 'x', 'utf8')
      await moveEntry(db, {
        userId,
        workspaceId,
        workspacePath,
        fromPath: 'old.md',
        toPath: 'new.md',
      })
      const onDisk = await readdir(workspacePath)
      expect(onDisk).toEqual(['new.md'])
      const activity = listFileActivitiesForWorkspace(db, workspaceId)
      expect(activity[0]?.activityKind).toBe('file-moved')
      expect(activity[0]?.editor).toBe('self')
      expect(activity[0]?.relativePath).toBe('new.md')
      expect(activity[0]?.fromPath).toBe('old.md')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('moves a file across parents', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, 'src'))
      await mkdir(path.join(workspacePath, 'dest'))
      await writeFile(path.join(workspacePath, 'src', 'note.md'), 'x', 'utf8')
      await moveEntry(db, {
        userId,
        workspaceId,
        workspacePath,
        fromPath: 'src/note.md',
        toPath: 'dest/note.md',
      })
      expect(await readFile(path.join(workspacePath, 'dest', 'note.md'), 'utf8')).toBe('x')
      expect(await readdir(path.join(workspacePath, 'src'))).toEqual([])
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('refuses to overwrite an existing target by default', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'a.md'), 'a', 'utf8')
      await writeFile(path.join(workspacePath, 'b.md'), 'b', 'utf8')
      await expect(
        moveEntry(db, { userId, workspaceId, workspacePath, fromPath: 'a.md', toPath: 'b.md' }),
      ).rejects.toThrow(/already exists/i)
      // Both files remain untouched.
      expect(await readFile(path.join(workspacePath, 'a.md'), 'utf8')).toBe('a')
      expect(await readFile(path.join(workspacePath, 'b.md'), 'utf8')).toBe('b')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('throws NotFoundError when fromPath does not exist', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        moveEntry(db, {
          userId,
          workspaceId,
          workspacePath,
          fromPath: 'missing.md',
          toPath: 'x.md',
        }),
      ).rejects.toThrow(/not found/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('creates the parent directory of toPath if it does not exist', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'src.md'), 'x', 'utf8')
      await moveEntry(db, {
        userId,
        workspaceId,
        workspacePath,
        fromPath: 'src.md',
        toPath: 'deep/dest/src.md',
      })
      expect(await readFile(path.join(workspacePath, 'deep', 'dest', 'src.md'), 'utf8')).toBe('x')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})

describe('deleteEntry', () => {
  it("hard-deletes a file + records 'file-deleted'", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'doomed.md'), 'x', 'utf8')
      await deleteEntry(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'doomed.md',
      })
      expect(await readdir(workspacePath)).toEqual([])
      const activity = listFileActivitiesForWorkspace(db, workspaceId)
      expect(activity[0]?.activityKind).toBe('file-deleted')
      expect(activity[0]?.editor).toBe('self')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("refuses to delete a non-empty directory without recursive: true (ConflictError)", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, 'stuff'))
      await writeFile(path.join(workspacePath, 'stuff', 'inside.md'), 'x', 'utf8')
      await expect(
        deleteEntry(db, {
          userId,
          workspaceId,
          workspacePath,
          relativePath: 'stuff',
        }),
      ).rejects.toThrow(/recursive: true/i)
      // Folder + its file survive.
      expect((await readdir(path.join(workspacePath, 'stuff'))).length).toBe(1)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it("recursively deletes a directory when recursive: true + records 'folder-deleted'", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, 'gone'))
      await writeFile(path.join(workspacePath, 'gone', 'a.md'), 'x', 'utf8')
      await deleteEntry(db, {
        userId,
        workspaceId,
        workspacePath,
        relativePath: 'gone',
        recursive: true,
      })
      expect(await readdir(workspacePath)).toEqual([])
      const activity = listFileActivitiesForWorkspace(db, workspaceId)
      expect(activity[0]?.activityKind).toBe('folder-deleted')
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('throws NotFoundError on a missing path', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        deleteEntry(db, {
          userId,
          workspaceId,
          workspacePath,
          relativePath: 'never-existed.md',
        }),
      ).rejects.toThrow(/not found/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('rejects deleting under .vynel/ (assertWritableTarget)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId, workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, '.vynel'))
      await writeFile(path.join(workspacePath, '.vynel', 'x.json'), '{}', 'utf8')
      await expect(
        deleteEntry(db, {
          userId,
          workspaceId,
          workspacePath,
          relativePath: '.vynel/x.json',
        }),
      ).rejects.toThrow(/reserved by Vynel/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})
