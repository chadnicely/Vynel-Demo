import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { recordDesktopAction } from '../repositories/desktop-actions.js'
import { desktopFeatureDescriptor } from './desktop-mcp-feature-descriptor.js'
import { DESKTOP_TOOL_INSTRUCTIONS, DESKTOP_ACT_INSTRUCTIONS } from './desktop-tool-instructions.js'

// Spy on the server builder so the descriptor's context → build-input threading
// is observable — the built SDK server itself is opaque.
vi.mock('./build-desktop-mcp-server.js', async () => {
  const actual = await vi.importActual<typeof import('./build-desktop-mcp-server.js')>(
    './build-desktop-mcp-server.js',
  )
  return { ...actual, buildDesktopMcpServer: vi.fn(actual.buildDesktopMcpServer) }
})
import { buildDesktopMcpServer } from './build-desktop-mcp-server.js'

// `build()` only closes over the reader (the tool handlers read it later), so a
// structural stand-in is enough to assert shape + buildability.
const baseContext: SessionToolContext = {
  db: {},
  userId: 'user-1',
  appRequest: () => new Response(),
}

describe('desktopFeatureDescriptor', () => {
  it('declares the PLAN as the ask-approval tier — the act tools left it (plan-level approval)', () => {
    expect(desktopFeatureDescriptor.serverName).toBe('desktop')
    // The standing-grant consent tool keeps the MUTATING tier: it cards in ask
    // + the unattended background default (no silent self-grant on a schedule
    // fire), and runs uncarded in the user's auto/bypass. The ask tier holds
    // ONLY `propose_desktop_plan` (Kafi 2026-08-11: one card per task, on the
    // plan) — the act tools are gated in-tool by the plan envelope instead, so
    // their presence here would re-create the per-step cards the plan removed.
    // test: correct expectation — was `['mcp__desktop__request_desktop_access']`.
    // That is the every-mode approval FLOOR, and it named a tool that no longer
    // exists. Nothing in this package cards in every mode now: acting is
    // authorized by the plan, and the plan cards in ask mode below.
    expect(desktopFeatureDescriptor.mutatingToolNames).toEqual([])
    expect(desktopFeatureDescriptor.askModeApprovalToolNames).toEqual([
      'mcp__desktop__propose_desktop_plan',
    ])
  })

  it('is not capability-gated (gated by reader presence + the env flag instead)', () => {
    expect(desktopFeatureDescriptor.capabilityGatedTools).toBeUndefined()
  })

  it('returns null when no desktop reader is present (the feature is not applicable)', () => {
    expect(desktopFeatureDescriptor.build(baseContext)).toBeNull()
  })

  it('builds a server when a reader is present', () => {
    const server = desktopFeatureDescriptor.build({ ...baseContext, desktopReader: {} })
    expect(server).not.toBeNull()
  })

  it('forwards the turn identity into the server input — the action record keys rows by it', () => {
    // If these spreads were dropped, every row would silently write NULL while
    // the repo, writer, and composer tests all stayed green — this is the one
    // link in the identity chain only this test observes.
    desktopFeatureDescriptor.build({
      ...baseContext,
      desktopReader: {},
      sessionId: 'primary-1',
      workspaceId: 'ws-1',
    })
    expect(vi.mocked(buildDesktopMcpServer)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'primary-1', workspaceId: 'ws-1' }),
    )
  })

  it('omits identity fields the context does not carry — absent, never undefined', () => {
    desktopFeatureDescriptor.build({ ...baseContext, desktopReader: {} })
    const lastInput = vi.mocked(buildDesktopMcpServer).mock.lastCall?.[0] ?? {}
    expect(lastInput).not.toHaveProperty('sessionId')
    expect(lastInput).not.toHaveProperty('workspaceId')
  })

  it('contributes the observe-only prompt when actions are off', () => {
    expect(desktopFeatureDescriptor.contributePrompt?.(baseContext)).toBe(DESKTOP_TOOL_INSTRUCTIONS)
    expect(
      desktopFeatureDescriptor.contributePrompt?.({ ...baseContext, enableDesktopActions: false }),
    ).toBe(DESKTOP_TOOL_INSTRUCTIONS)
  })

  it('appends the act prompt when actions are enabled', () => {
    expect(
      desktopFeatureDescriptor.contributePrompt?.({ ...baseContext, enableDesktopActions: true }),
    ).toBe(`${DESKTOP_TOOL_INSTRUCTIONS}\n\n${DESKTOP_ACT_INSTRUCTIONS}`)
  })

  it('appends the continuation section when the session has a recent recorded task', async () => {
    // The full turn-start read: rows recorded under this session surface as
    // "last time I got as far as X — ask before carrying on".
    await withTestDatabase(async (db) => {
      const now = new Date()
      const user = insertUser(db, {
        id: randomUUID(),
        displayName: 'Test User',
        emailAddress: null,
        locale: 'en-US',
        timezone: 'UTC',
        hasCompletedOnboarding: false,
        createdAt: now,
        updatedAt: now,
      })
      recordDesktopAction(db, {
        userId: user.id,
        sessionId: 'primary-1',
        goal: 'send the weekly report',
        tool: 'act_on_app',
        appName: 'Outlook',
        detail: 'clicked Send',
        outcome: 'unverified',
      })
      const section = desktopFeatureDescriptor.contributePrompt?.({
        ...baseContext,
        db,
        userId: user.id,
        sessionId: 'primary-1',
      })
      expect(section).toContain(DESKTOP_TOOL_INSTRUCTIONS)
      expect(section).toContain('send the weekly report')
      expect(section).toContain('ASK whether to carry on')

      // A DIFFERENT session sees nothing — the record is task-scoped, and a
      // sessionless turn (no stable identity) stays on the plain instructions.
      expect(
        desktopFeatureDescriptor.contributePrompt?.({
          ...baseContext,
          db,
          userId: user.id,
          sessionId: 'primary-other',
        }),
      ).toBe(DESKTOP_TOOL_INSTRUCTIONS)
      expect(
        desktopFeatureDescriptor.contributePrompt?.({ ...baseContext, db, userId: user.id }),
      ).toBe(DESKTOP_TOOL_INSTRUCTIONS)
    })
  })
})
