// Tests the Q2 wire in `startChatTurn` — that chat-core passes an
// `onCompaction` callback to the provider that records the
// `session.compacted` outbox event via `captureCompactionSummary`. The
// provider (the SDK boundary) is mocked; the DB + captureCompactionSummary
// are real, so this exercises the chat-core -> session-continuity link
// end-to-end. Spec: session-continuity completion brief §2.1.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

// Capture the StartChatSessionInput the provider receives. vi.hoisted so the
// shared array exists when vi.mock's factory runs.
const { capturedInputs } = vi.hoisted(() => ({
  capturedInputs: [] as Array<Record<string, unknown>>,
}))

vi.mock('@vynel/providers', () => ({
  resolveAiAgentProvider: () => ({
    startChatSession: (input: Record<string, unknown>) => {
      capturedInputs.push(input)
      // Empty stream — the turn completes immediately; we only need the
      // captured onCompaction callback.
      return (async function* () {})()
    },
  }),
}))

import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertPrimarySession } from '../repositories/index.js'
import { insertChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SESSION_COMPACTED_EVENT_TYPE, markPendingCheckpoint } from '../continuity/index.js'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'
import { startChatTurn } from './start-chat-turn.js'

/** The turn-time marker rides EVERY turn (`resolve-turn-time-marker.ts`, proven
 *  there and in the composer's own tests). These assertions are about the OTHER
 *  markers, so the clock line is stripped rather than pinned to a moving now. */
const withoutTurnTime = (text: unknown): string =>
  (typeof text === 'string' ? text : '')
    .split('\n\n')
    .filter((part) => !part.startsWith('(Right now it is'))
    .join('\n\n')


function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

type OnCompaction = (capture: { sdkSessionId: string; summary: string }) => Promise<void>

beforeEach(() => {
  capturedInputs.length = 0
})

describe('startChatTurn — onCompaction wiring (Q2)', () => {
  it('passes an onCompaction that records a session.compacted event for a tracked primary', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // A primary linked to the SDK session id the capture will carry.
      const now = new Date()
      insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        currentSdkSessionId: 'sdk-x',
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })

      // Drain the turn (empty provider stream) so startChatSession runs and
      // captures the input passed to the provider.
      for await (const _event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        userMessageText: 'hi',
        permissionMode: 'ask',
      })) {
        void _event
      }

      const onCompaction = capturedInputs.at(-1)?.onCompaction as OnCompaction | undefined
      expect(onCompaction).toBeDefined()

      // Invoking it (as the PostCompact hook would) writes the outbox event.
      await onCompaction!({ sdkSessionId: 'sdk-x', summary: 'carry me forward' })

      const events = listOutboxEventsByType(db, SESSION_COMPACTED_EVENT_TYPE)
      expect(events).toHaveLength(1)
    })
  })

  it('is a no-op (no outbox row) when the SDK session is not a tracked primary', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      for await (const _event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        userMessageText: 'hi',
        permissionMode: 'ask',
      })) {
        void _event
      }

      const onCompaction = capturedInputs.at(-1)?.onCompaction as OnCompaction | undefined
      await onCompaction!({ sdkSessionId: 'sdk-untracked', summary: 'nothing to carry' })

      expect(listOutboxEventsByType(db, SESSION_COMPACTED_EVENT_TYPE)).toHaveLength(0)
    })
  })
})

describe('startChatTurn — checkpoint + auto-continue wiring (session-continuity §4.6)', () => {
  it('arms the mid-turn context nudge only for a CONTINUING identity, at the threshold in force', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const now = new Date()
      const primary = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        currentSdkSessionId: null,
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      const baseInput = {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude' as const,
        userMessageText: 'hi',
        permissionMode: 'ask' as const,
      }
      // A plain conversation: no continuity → no nudge (it neither swaps nor continues).
      for await (const _event of startChatTurn(db, baseInput)) void _event
      expect(capturedInputs.at(-1)?.onToolResultContext).toBeUndefined()

      // The continuing identity, with the smoke threshold: the nudge speaks
      // once the live state crosses IT (5% of the 200k default window).
      for await (const _event of startChatTurn(db, {
        ...baseInput,
        continuity: { primarySessionId: primary.id, threshold: 0.05 },
      })) {
        void _event
      }
      const nudge = capturedInputs.at(-1)?.onToolResultContext as
        | ((state: { usedTokens: number; model: string | null }) => string | null)
        | undefined
      expect(nudge).toBeDefined()
      expect(nudge!({ usedTokens: 9_000, model: null })).toBeNull()
      expect(nudge!({ usedTokens: 11_000, model: null })).toContain('CONTEXT CHECK')
    })
  })

  it('a continuation turn hands the model the provider text and persists the short anchor row, stamped', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // A RESUMED segment (a continuation always resumes the head): the user
      // row persists durability-first, before the (empty) provider stream.
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'sdk-head',
          userId: user.id,
          workspaceId: workspace.id,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Head',
          visibility: 'hidden',
        }),
      )
      let persistedBody: string | null = null
      let persistedSourceKind: string | null | undefined
      for await (const event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        resumeSessionId: 'sdk-head',
        userMessageText: 'Continuing after patching context — next: sum the receipts',
        providerUserMessageText: 'This message is from Vynel, not the user. NEXT STEP: sum the receipts',
        messageAttribution: { userSourceKind: 'global-root' },
        permissionMode: 'ask',
      })) {
        if (event.kind === 'user-message-persisted') {
          persistedBody = event.message.body
          persistedSourceKind = event.message.sourceKind
        }
      }
      // The provider read the instruction; the row kept the anchor.
      expect(withoutTurnTime(capturedInputs.at(-1)?.userMessageText)).toBe(
        'This message is from Vynel, not the user. NEXT STEP: sum the receipts',
      )
      expect(persistedBody).toBe('Continuing after patching context — next: sum the receipts')
      expect(persistedSourceKind).toBe('global-root')
    })
  })
})

describe('startChatTurn — the autopilot marker (session-hardening D8/B1)', () => {
  it('appends the marker to the PROVIDER text while the persisted row stays clean', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'sdk-autopilot',
          userId: user.id,
          workspaceId: workspace.id,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Head',
        }),
      )
      let persistedBody: string | null = null
      for await (const event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        resumeSessionId: 'sdk-autopilot',
        userMessageText: 'ship the landing page',
        autoBuildout: true,
        permissionMode: 'auto',
      })) {
        if (event.kind === 'user-message-persisted') persistedBody = event.message.body
      }
      const providerText = capturedInputs.at(-1)?.userMessageText as string
      expect(providerText).toContain('ship the landing page')
      expect(providerText).toContain(loadSessionInstruction('autopilot-marker'))
      // The transcript shows what the user typed — the marker is provider-only.
      expect(persistedBody).toBe('ship the landing page')
    })
  })

  it('rides a CONTINUATION turn as well — it decorates the provider text, not the raw body', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      for await (const _event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        userMessageText: 'Continuing after patching context',
        providerUserMessageText: 'NEXT STEP: sum the receipts',
        autoBuildout: true,
        permissionMode: 'auto',
      })) {
        void _event
      }
      const providerText = capturedInputs.at(-1)?.userMessageText as string
      expect(providerText).toContain('NEXT STEP: sum the receipts')
      expect(providerText).toContain('AUTOPILOT')
      expect(providerText).not.toContain('Continuing after patching context')
    })
  })

  it('omitted or false leaves the provider text untouched', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const baseInput = {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude' as const,
        userMessageText: 'just this',
        permissionMode: 'auto' as const,
      }
      for await (const _event of startChatTurn(db, baseInput)) void _event
      expect(withoutTurnTime(capturedInputs.at(-1)?.userMessageText)).toBe('just this')

      for await (const _event of startChatTurn(db, { ...baseInput, autoBuildout: false })) {
        void _event
      }
      expect(withoutTurnTime(capturedInputs.at(-1)?.userMessageText)).toBe('just this')
    })
  })
})

// The TURN-TIME marker: a model reads no clock, so a relative question was
// answered off a guessed hour ("02:51 + 15 min = 2:07"). Every turn through
// this path carries the user's own wall clock, exactly once.
describe('startChatTurn — the turn-time marker', () => {
  it("states the USER's wall clock once, whatever else rides the turn", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, { ...makeUser(), timezone: 'Asia/Tokyo' })
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      for await (const _event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        userMessageText: 'remind me in 15 minutes',
        permissionMode: 'auto',
        autoBuildout: true,
      })) {
        void _event
      }

      const providerText = String(capturedInputs.at(-1)?.userMessageText ?? '')
      expect(providerText).toContain('Asia/Tokyo')
      expect(providerText.match(/Right now it is/g)).toHaveLength(1)
      // It never crowds out what else the turn owes the model.
      expect(providerText).toContain('AUTOPILOT')
      expect(providerText).toContain('remind me in 15 minutes')
    })
  })
})

// The RESTART SURVIVOR marker (audit r2 R2-H): every caller that passes
// `continuity` runs a turn that auto-continues, so a checkpoint still pending
// as the turn composes is one an earlier turn left — the model is told it owes
// that step instead of overwriting it blind. The persisted row is untouched.
describe('startChatTurn — the survivor checkpoint marker', () => {
  it('appends the marker (provider input only) when the identity owes a step', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const now = new Date()
      const primary = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        scope: 'workspace',
        currentSdkSessionId: null,
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      markPendingCheckpoint(db, primary.id, 'reconcile the invoices')

      for await (const _event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        userMessageText: 'what about tuesday?',
        permissionMode: 'auto',
        continuity: { primarySessionId: primary.id, autoContinues: true },
      })) {
        void _event
      }

      const providerText = capturedInputs.at(-1)?.userMessageText as string
      expect(providerText).toContain('what about tuesday?')
      expect(providerText).toContain('reconcile the invoices')
      expect(providerText.match(/CHECKPOINT PENDING/g)).toHaveLength(1)
    })
  })

  it('stays SILENT on a turn the runner will not continue (the schedule fire passes continuity, not autoContinues)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const now = new Date()
      const primary = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        scope: 'workspace',
        currentSdkSessionId: null,
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      markPendingCheckpoint(db, primary.id, 'reconcile the invoices')

      for await (const _event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        userMessageText: 'the 9am schedule fired',
        permissionMode: 'auto',
        continuity: { primarySessionId: primary.id },
      })) {
        void _event
      }
      // Promising a pick-up nothing performs would be R2-N's lie, reissued.
      expect(withoutTurnTime(capturedInputs.at(-1)?.userMessageText)).toBe(
        'the 9am schedule fired',
      )
    })
  })

  it('adds nothing when nothing is pending, or when the turn has no continuing identity', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const now = new Date()
      const primary = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        scope: 'workspace',
        currentSdkSessionId: null,
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })

      for await (const _event of startChatTurn(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        providerId: 'claude',
        userMessageText: 'plain',
        permissionMode: 'auto',
        continuity: { primarySessionId: primary.id },
      })) {
        void _event
      }
      expect(withoutTurnTime(capturedInputs.at(-1)?.userMessageText)).toBe('plain')
    })
  })
})
