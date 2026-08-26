import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { withTestDatabase } from '@vynel/testing'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { createWorkspace } from './create-workspace.js'
import { WORKSPACE_CREATED_EVENT } from '../workspaces-events.js'

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// An EXISTING directory the user would select.
function existingDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'vynel-ws-'))
}

describe('createWorkspace (existing-directory model)', () => {
  it('registers an existing directory: row + .vynel + outbox; leaves the folder layout alone', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const directory = existingDir()

      const workspace = await createWorkspace(db, {
        userId: user.id,
        name: 'Acme Inc.',
        kind: 'small-business',
        directory,
      })

      expect(workspace.userId).toBe(user.id)
      expect(workspace.kind).toBe('small-business')
      // brain-tree Ch5 — the default persona name IS the workspace name (Kafi, 2026-08-19).
      expect(workspace.managerName).toBe('Acme Inc.')

      // Vynel's metadata dir exists (identity files are retired — A2)...
      expect(existsSync(path.join(workspace.path, '.vynel'))).toBe(true)
      // ...but the user's folder is untouched — no Vynel base folders AND no
      // identity .md files are written.
      for (const name of ['Inbox', 'Drafts', 'Notes', 'Files', 'Archive', 'USER.md', 'PREFERENCES.md', 'MEMORY.md']) {
        expect(existsSync(path.join(workspace.path, name))).toBe(false)
      }

      const events = outboxRepository.listOutboxEventsByType(db, WORKSPACE_CREATED_EVENT)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ workspaceId: workspace.id, userId: user.id })
    })
  })

  it("defaults kind to 'personal' when omitted (the kind picker was retired — F4)", async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      // No `kind` in the input — the core supplies the default (no DB DEFAULT).
      const workspace = await createWorkspace(db, {
        userId: user.id,
        name: 'No Kind',
        directory: existingDir(),
      })

      expect(workspace.kind).toBe('personal')
      // The default flows into the outbox event payload too.
      const events = outboxRepository.listOutboxEventsByType(db, WORKSPACE_CREATED_EVENT)
      expect(events[0]!.payload).toMatchObject({ kind: 'personal' })
    })
  })

  it('is born into the given group; a foreign group 404s before anything is written', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const stranger = makeUser()
      insertUser(db, stranger)
      const now = new Date()
      const group = workspacesRepository.insertWorkspaceGroup(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Clients',
        createdAt: now,
        updatedAt: now,
      })
      const foreignGroup = workspacesRepository.insertWorkspaceGroup(db, {
        id: randomUUID(),
        userId: stranger.id,
        name: 'Theirs',
        createdAt: now,
        updatedAt: now,
      })

      const workspace = await createWorkspace(db, {
        userId: user.id,
        name: 'Acme',
        directory: existingDir(),
        groupId: group.id,
      })
      expect(workspace.groupId).toBe(group.id)

      const directory = existingDir()
      await expect(
        createWorkspace(db, { userId: user.id, name: 'Nope', directory, groupId: foreignGroup.id }),
      ).rejects.toThrow(NotFoundError)
      expect(workspacesRepository.findWorkspaceByNormalizedPath(db, user.id, directory)).toBeNull()
      // The refused registration also took back the .vynel it had just made —
      // the user's folder is left exactly as it was found.
      expect(existsSync(path.join(directory, '.vynel'))).toBe(false)
    })
  })

  it('rejects adding the same directory twice (exact + trailing-separator forms)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const directory = existingDir()

      await createWorkspace(db, { userId: user.id, name: 'A', kind: 'personal', directory })

      // Exact re-add.
      await expect(
        createWorkspace(db, { userId: user.id, name: 'A again', kind: 'personal', directory }),
      ).rejects.toBeInstanceOf(ConflictError)

      // Same directory, trailing separator → canonicalized to the same path.
      await expect(
        createWorkspace(db, {
          userId: user.id,
          name: 'A slash',
          kind: 'personal',
          directory: directory + path.sep,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  it('rejects re-adding the directory of an ARCHIVED workspace (it still owns the folder)', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const directory = existingDir()

      const workspace = await createWorkspace(db, {
        userId: user.id,
        name: 'Archived',
        kind: 'personal',
        directory,
      })
      workspacesRepository.updateWorkspace(db, workspace.id, { isArchived: true })

      await expect(
        createWorkspace(db, { userId: user.id, name: 'Re-add', kind: 'personal', directory }),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  it('throws ValidationError when the directory does not exist', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const missing = path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`)

      await expect(
        createWorkspace(db, { userId: user.id, name: 'X', kind: 'personal', directory: missing }),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('throws ValidationError when the path is a file, not a directory', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const file = path.join(existingDir(), 'a-file.txt')
      writeFileSync(file, 'not a dir')

      await expect(
        createWorkspace(db, { userId: user.id, name: 'X', kind: 'personal', directory: file }),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
})
