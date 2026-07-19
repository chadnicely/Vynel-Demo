import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { setCapabilityEnabled } from '@vynel/capabilities'
import { createMemoryEntry } from '@vynel/memory'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'
import { composeSessionCapabilities } from './compose-session-capabilities.js'

function seed(db: Database) {
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

function addMemoryEntry(db: Database, userId: string, workspaceId: string) {
  createMemoryEntry(db, {
    userId,
    workspaceId,
    kind: 'person',
    title: 'Sarah Chen',
    body: 'Head of partnerships at Acme.',
    category: 'memory',
    section: 'Key contacts',
    createdSource: 'user-manual',
  })
}

describe('composeSessionCapabilities', () => {
  it('always includes the Vynel operating-rules', async () => {
    await withTestDatabase((db) => {
      const { workspace } = seed(db)
      const composed = composeSessionCapabilities(db, { workspaceId: workspace.id })
      expect(composed.systemPromptAppend).toContain(loadSessionInstruction('workspace-agent'))
    })
  })

  // test: correct expectation — capabilities now default ON with no row, so
  // "not enabled" requires an EXPLICIT disable (was: no row = off).
  it('omits the memory contribution when the memory capability is explicitly disabled', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seed(db)
      addMemoryEntry(db, user.id, workspace.id) // entries exist, but memory is toggled OFF
      setCapabilityEnabled(db, {
        userId: user.id,
        workspaceId: workspace.id,
        capabilityId: 'memory',
        isEnabled: false,
      })
      const composed = composeSessionCapabilities(db, { workspaceId: workspace.id })
      expect(composed.systemPromptAppend).not.toContain('Head of partnerships at Acme.')
    })
  })

  it('includes the memory snapshot by default (no capability rows)', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seed(db)
      addMemoryEntry(db, user.id, workspace.id)
      const composed = composeSessionCapabilities(db, { workspaceId: workspace.id })
      expect(composed.systemPromptAppend).toContain('Head of partnerships at Acme.')
    })
  })

  // The MCP-tool deny gate moved to composeSessionMcpServers in the C4 build;
  // its coverage (incl. the real-DB capability state) lives in
  // compose-session-mcp-servers.test.ts.
})
