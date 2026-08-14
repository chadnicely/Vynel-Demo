// Tests for createWorkspaceGroup — insert + outbox co-commit + name rules.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createWorkspaceGroup } from './create-workspace-group.js'
import { WORKSPACE_GROUP_CREATED_EVENT } from '../workspaces-events.js'

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

describe('createWorkspaceGroup', () => {
  it('inserts the group and co-commits workspace-group.created', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      const group = await createWorkspaceGroup(db, { userId: user.id, name: '  Development  ' })

      expect(group.name).toBe('Development')
      expect(group.userId).toBe(user.id)

      const events = listOutboxEventsByType(db, WORKSPACE_GROUP_CREATED_EVENT)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        groupId: group.id,
        userId: user.id,
        name: 'Development',
      })
    })
  })

  it('rejects empty and over-long names', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      await expect(createWorkspaceGroup(db, { userId: user.id, name: '   ' })).rejects.toThrow(
        ValidationError,
      )
      await expect(
        createWorkspaceGroup(db, { userId: user.id, name: 'x'.repeat(61) }),
      ).rejects.toThrow(ValidationError)
    })
  })
})
