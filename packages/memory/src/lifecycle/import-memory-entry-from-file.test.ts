import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listMemoryTagsForEntries } from '../repositories/index.js'
import { importMemoryEntryFromFile } from './import-memory-entry-from-file.js'

function seedWorld(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

describe('importMemoryEntryFromFile', () => {
  it('reads a markdown file into a tagged memory entry', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-mem-'))
    const file = path.join(dir, 'standing-notes.md')
    try {
      await writeFile(file, '# Standing notes\n\nInvoices go out on the 1st.', 'utf8')
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        const entry = await importMemoryEntryFromFile(db, {
          userId: user.id,
          workspaceId: workspace.id,
          absolutePath: file,
          tags: ['Context', 'billing'],
        })
        expect(entry.title).toBe('standing-notes.md')
        expect(entry.body).toContain('Invoices go out on the 1st.')
        expect(entry.createdSource).toBe('file-import')
        expect(listMemoryTagsForEntries(db, [entry.id]).get(entry.id)).toEqual([
          'billing',
          'context',
        ])
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects an oversized file with a pointer to Knowledge', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-mem-'))
    const file = path.join(dir, 'huge.txt')
    try {
      await writeFile(file, 'x'.repeat(30_000), 'utf8')
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        await expect(
          importMemoryEntryFromFile(db, {
            userId: user.id,
            workspaceId: workspace.id,
            absolutePath: file,
          }),
        ).rejects.toThrow(/Knowledge/)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects an unsupported file type in plain words', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-mem-'))
    const file = path.join(dir, 'setup.exe')
    try {
      await writeFile(file, 'MZ', 'utf8')
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedWorld(db)
        await expect(
          importMemoryEntryFromFile(db, {
            userId: user.id,
            workspaceId: workspace.id,
            absolutePath: file,
          }),
        ).rejects.toThrow(/can't be read into memory/)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
