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
import { SessionActivityFeed } from '@vynel/session/runtime'
import { SessionTargetLocks } from '@vynel/session/delegation'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '@vynel/session/continuity'
import { insertChatSession, updateChatSession, type ChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { buildScheduleFireDeps } from './build-schedule-fire-deps.js'

const silentLogger = pino({ level: 'silent' })
// The tool handlers close over appRequest; building the server never invokes it.
const fakeAppRequest = vi.fn(() => new Response('{}', { status: 200 })) as unknown as HonoAppRequestFn
const realOptions = () => ({
  appRequest: fakeAppRequest,
  logger: silentLogger,
  activityFeed: new SessionActivityFeed(),
  targetLocks: new SessionTargetLocks(),
})

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
    await withTestDatabase(async () => {
      const deps = await buildScheduleFireDeps(realOptions())
      expect(typeof deps.startChatTurn).toBe('function')
      expect(typeof deps.composeWorkspaceMcpServers).toBe('function')
      expect(typeof deps.composeSessionCapabilities).toBe('function')
      expect(typeof deps.startGlobalRootTurn).toBe('function')
      expect(typeof deps.resolveWorkspaceTurnSettings).toBe('function')
      expect(typeof deps.renderScheduleFireMarker).toBe('function')
    })
  })

  it('renderScheduleFireMarker renders the REAL instruction: named, timed, attributed to the scheduler', async () => {
    await withTestDatabase(async () => {
      const deps = await buildScheduleFireDeps(realOptions())

      const marker = deps.renderScheduleFireMarker({
        scheduleDisplayName: 'Tea',
        firedAtLocal: 'Aug 20, 2026, 2:00 PM',
      })

      expect(marker).toContain('firing the schedule "Tea" now (Aug 20, 2026, 2:00 PM)')
      expect(marker).toContain('NOT the user typing')
      expect(marker).toContain('never create a timer')
      expect(marker).not.toContain('{{')
    })
  })

  it('composeWorkspaceMcpServers builds the live vynel server from the generated registry', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      const deps = await buildScheduleFireDeps(realOptions())

      const composed = deps.composeWorkspaceMcpServers({ db, userId, workspaceId })

      expect(composed.mcpServers).toHaveProperty('vynel')
      expect(composed.mcpServers.vynel).toBeDefined()
      // test: correct expectation — the workspace descriptor list grew: the
      // notebook feature (instructions slice) now rides every workspace turn.
      expect(composed.mcpServers).toHaveProperty('vynel-notebook')
      expect('allowedMcpToolPatterns' in composed).toBe(false)
      // fakeAppRequest closes into the tool handlers but is never called at build.
      expect(fakeAppRequest).not.toHaveBeenCalled()
    })
  })

  it('composeSessionCapabilities returns the composed system-prompt append', async () => {
    await withTestDatabase(async (db) => {
      const { workspaceId } = seedWorkspace(db)
      const deps = await buildScheduleFireDeps(realOptions())

      const composed = deps.composeSessionCapabilities(db, { workspaceId, workspaceName: 'Fired workspace' })

      expect(typeof composed.systemPromptAppend).toBe('string')
      expect(composed.systemPromptAppend.length).toBeGreaterThan(0)
    })
  })
})

// Background-turns BT2: the bound settings resolver reads the workspace
// PRIMARY's head row through the delegated paths' one rule (`target row ??
// DEFAULT`) — real rows, no stubs. Since schedule-on-primary (Kafi
// 2026-08-20) the fire RESUMES that head, so its occupancy rides the turn and
// the model pick is fit-clamped like every other resumed background pick.
function seedWorkspacePrimaryHead(
  db: Database,
  userId: string,
  workspaceId: string,
  settings: Partial<
    Pick<ChatSession, 'sessionMode' | 'selectedModel' | 'thinkingEffort' | 'autoBuildout' | 'lastContextTokens' | 'model'>
  >,
): Promise<string> {
  const sdkSessionId = `sdk-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({ sessionId: sdkSessionId, userId, workspaceId, providerId: 'claude', startedAt: new Date() }),
  )
  updateChatSession(db, sdkSessionId, settings)
  return getOrCreatePrimarySession(db, { userId, workspaceId }).then((primary) => {
    linkPrimarySessionToSdkSession(db, { primarySessionId: primary.id, userId, sdkSessionId })
    return sdkSessionId
  })
}

describe('buildScheduleFireDeps — resolveWorkspaceTurnSettings (target row ?? DEFAULT, fit-clamped)', () => {
  it('answers the one default when the workspace has no primary conversation yet', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      const deps = await buildScheduleFireDeps(realOptions())
      expect(deps.resolveWorkspaceTurnSettings(db, { userId, workspaceId })).toEqual({
        permissionMode: 'auto',
        model: undefined,
        thinkingEffort: undefined,
        autoBuildout: false,
      })
    })
  })

  it('answers what the user chose for the workspace primary (mode / model / effort / autopilot)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      await seedWorkspacePrimaryHead(db, userId, workspaceId, {
        sessionMode: 'ask',
        selectedModel: 'claude-sonnet-4-5',
        thinkingEffort: 'high',
        autoBuildout: true,
      })
      const deps = await buildScheduleFireDeps(realOptions())
      expect(deps.resolveWorkspaceTurnSettings(db, { userId, workspaceId })).toEqual({
        permissionMode: 'ask',
        model: 'claude-sonnet-4-5',
        thinkingEffort: 'high',
        autoBuildout: true,
      })
    })
  })

  // test: correct expectation — schedule-on-primary reversed D3: the fire
  // RESUMES the primary head, so occupancy carries and the delegated fit
  // clamp applies again; was: unclamped (the fresh-session rule made the
  // head's occupancy irrelevant).
  it('CLAMPS a model pick the head’s occupancy cannot fit — the fire resumes the head, so the clamp is live again', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      // 400k tokens grown under a 1M-window model: the user's haiku pick
      // (200k window) cannot hold what the resumed head already carries — the
      // turn runs on the model that grew the chain instead of dying with
      // "Prompt is too long" on a surface with nobody watching.
      await seedWorkspacePrimaryHead(db, userId, workspaceId, {
        selectedModel: 'claude-haiku-4-5',
        lastContextTokens: 400_000,
        model: 'claude-opus-4-6',
      })
      const deps = await buildScheduleFireDeps(realOptions())
      expect(deps.resolveWorkspaceTurnSettings(db, { userId, workspaceId }).model).toBe('claude-opus-4-6')
    })
  })

  it('a pick the head’s occupancy fits runs unreplaced', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedWorkspace(db)
      await seedWorkspacePrimaryHead(db, userId, workspaceId, {
        selectedModel: 'claude-haiku-4-5',
        lastContextTokens: 40_000,
        model: 'claude-opus-4-6',
      })
      const deps = await buildScheduleFireDeps(realOptions())
      expect(deps.resolveWorkspaceTurnSettings(db, { userId, workspaceId }).model).toBe('claude-haiku-4-5')
    })
  })
})
