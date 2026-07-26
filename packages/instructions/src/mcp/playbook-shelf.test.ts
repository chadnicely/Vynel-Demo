import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createInstructionDocument } from '../lifecycle/create-instruction-document.js'
import { insertDocument } from '../repositories/index.js'
import { listPlaybooks, findPlaybookById, deriveOneLiner } from './playbook-shelf.js'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

// `workspaceId` is a real FK — a workspace-scoped doc needs a live workspace row.
function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

describe('listPlaybooks', () => {
  it('merges the verified shelf with the caller-scope user docs', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const workspaceId = seedWorkspace(db, user.id).id
      createInstructionDocument(db, {
        userId: user.id,
        scope: 'global',
        title: 'My global book',
        body: 'How I like things done.',
      })
      createInstructionDocument(db, {
        userId: user.id,
        scope: 'workspace',
        workspaceId,
        title: 'My workspace book',
        body: 'Shop-specific guidance.',
      })

      const globalShelf = listPlaybooks(db, { userId: user.id })
      expect(globalShelf.filter((p) => p.verified).map((p) => p.id)).toEqual([
        'communicating-with-users',
        // test: correct expectation — the node-app-scaffold, node-sdk, and
        // project-kickoff playbooks joined the shipped shelf (notebook arc,
        // 2026-07-27).
        'node-app-scaffold',
        // test: correct expectation — the mcp-server playbook joined the
        // shipped shelf (notebook arc, 2026-07-27).
        'node-mcp-server',
        'node-sdk-from-api',
        'starting-a-project-from-scratch',
        // test: correct expectation — the task-planner and vue/nuxt frontend
        // playbooks joined the shipped shelf (notebook arc, 2026-07-27).
        'task-planner',
        'vue-nuxt-app-scaffold',
        'web-app-scaffold',
        // test: correct expectation — the server-work playbook joined the
        // shipped shelf (ssh module, 2026-07-17).
        'working-with-servers',
      ])
      expect(globalShelf.filter((p) => !p.verified).map((p) => p.title)).toEqual([
        'My global book',
      ])

      const workspaceShelf = listPlaybooks(db, { userId: user.id, workspaceId })
      expect(workspaceShelf.filter((p) => !p.verified).map((p) => p.title)).toEqual([
        'My global book',
        'My workspace book',
      ])
    })
  })

  it('excludes disabled docs and derives the user-doc one-liner from the body', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      createInstructionDocument(db, {
        userId: user.id,
        scope: 'global',
        title: 'Off',
        body: 'x',
        enabled: false,
      })
      createInstructionDocument(db, {
        userId: user.id,
        scope: 'global',
        title: 'On',
        body: '# Heading\n\nFirst real line of guidance.',
      })
      const userBooks = listPlaybooks(db, { userId: user.id }).filter((p) => !p.verified)
      expect(userBooks).toHaveLength(1)
      expect(userBooks[0]!.oneLiner).toBe('Heading')
    })
  })
})

describe('findPlaybookById', () => {
  it('returns a verified book with its body; verified wins an id collision', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const now = new Date()
      // A deliberately crafted collision (user ids are normally UUIDs).
      insertDocument(db, {
        id: 'web-app-scaffold',
        userId: user.id,
        scope: 'global',
        workspaceId: null,
        mode: 'notebook',
        title: 'Impostor',
        body: 'Not the real book.',
        enabled: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })

      const playbook = findPlaybookById(db, { userId: user.id }, 'web-app-scaffold')
      expect(playbook?.verified).toBe(true)
      expect(playbook?.title).not.toBe('Impostor')

      // And the shadowed user doc is dropped from the list too — the two
      // tools tell the same story.
      const shelf = listPlaybooks(db, { userId: user.id })
      expect(shelf.filter((p) => p.id === 'web-app-scaffold')).toHaveLength(1)
    })
  })

  it('returns a user doc by id within scope, null outside it or when unknown', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const workspaceId = seedWorkspace(db, user.id).id
      const document = createInstructionDocument(db, {
        userId: user.id,
        scope: 'workspace',
        workspaceId,
        title: 'Workspace-only',
        body: 'Scoped guidance.',
      })

      expect(findPlaybookById(db, { userId: user.id, workspaceId }, document.id)?.body).toBe(
        'Scoped guidance.',
      )
      // A global-root turn must not see a workspace-scoped doc.
      expect(findPlaybookById(db, { userId: user.id }, document.id)).toBeNull()
      expect(findPlaybookById(db, { userId: user.id }, randomUUID())).toBeNull()
    })
  })
})

describe('deriveOneLiner', () => {
  it('takes the first non-empty line, stripped of markdown prefixes, capped at 140 chars', () => {
    expect(deriveOneLiner('\n\n- first bullet\nsecond')).toBe('first bullet')
    expect(deriveOneLiner(`${'a'.repeat(200)}`)).toHaveLength(140)
    expect(deriveOneLiner('')).toBe('')
  })
})
