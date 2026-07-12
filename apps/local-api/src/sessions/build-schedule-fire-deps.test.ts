// Real-path test for the schedule fire-deps builder — NOTHING is mocked. It
// proves the keystone import chain resolves end to end: the dynamic
// `@vynel/mcp` import yields `vynelWorkspaceDescriptor`, and
// `composeSessionMcpServers([vynelWorkspaceDescriptor], …)` builds the live
// in-process `vynel` server from the generated registry. It stops short of
// `startChatTurn` (no AI turn) — the fire path's turn is covered by
// fire-schedule.test.ts against a fake. This is the only test that exercises the
// REAL composition the boot service + fire-now routes wire (every other test
// fakes it), so a forgotten barrel export or wrong import specifier fails HERE.

import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { HonoAppRequestFn } from '../factory.js'
import { buildScheduleFireDeps } from './build-schedule-fire-deps.js'

const silentLogger = pino({ level: 'silent' })
// The tool handlers close over appRequest; building the server never invokes it.
const fakeAppRequest = vi.fn(() => new Response('{}', { status: 200 })) as unknown as HonoAppRequestFn

function seedWorkspace(db: Database): {
  userId: string
  workspaceId: string
} {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
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
  return { userId: user.id, workspaceId: workspace.id }
}

describe('buildScheduleFireDeps (real composition — no mocks)', () => {
  it('binds startChatTurn + the capability/MCP composition', async () => {
    await withTestDatabase(async (db) => {
      const deps = await buildScheduleFireDeps(db, fakeAppRequest, silentLogger)
      expect(typeof deps.startChatTurn).toBe('function')
      expect(typeof deps.composeWorkspaceMcpServers).toBe('function')
      expect(typeof deps.composeSessionCapabilities).toBe('function')
    })
  })

  it('composeWorkspaceMcpServers builds the live vynel server from the generated registry', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      const deps = await buildScheduleFireDeps(db, fakeAppRequest, silentLogger)

      const composed = deps.composeWorkspaceMcpServers({ db, userId, workspaceId })

      expect(composed.mcpServers).toHaveProperty('vynel')
      expect(composed.mcpServers.vynel).toBeDefined()
      // test: correct expectation — the workspace descriptor list grew: the
      // notebook feature (instructions slice) now rides every workspace turn.
      expect(composed.mcpServers).toHaveProperty('vynel-notebook')
      expect(composed.allowedMcpToolPatterns).toEqual(['mcp__vynel__*', 'mcp__vynel-notebook__*'])
      // fakeAppRequest closes into the tool handlers but is never called at build.
      expect(fakeAppRequest).not.toHaveBeenCalled()
    })
  })

  it('composeSessionCapabilities returns the composed system-prompt append', async () => {
    await withTestDatabase(async (db) => {
      const { workspaceId } = seedWorkspace(db)
      const deps = await buildScheduleFireDeps(db, fakeAppRequest, silentLogger)

      const composed = deps.composeSessionCapabilities(db, { workspaceId })

      expect(typeof composed.systemPromptAppend).toBe('string')
      expect(composed.systemPromptAppend.length).toBeGreaterThan(0)
    })
  })
})
