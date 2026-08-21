// VERIFICATION suite (channels fix arc, agent B): the guarantees that keep a
// Telegram-originated turn off an approval card the sender cannot see.
//
// Scope of THIS file — the two links that had no test of their own:
//   1. the GLOBAL-ROOT channel runner's permission-mode resolution, over a REAL
//      SQLite chat_sessions row (the exact `input ?? row ?? DEFAULT` expression
//      `run-global-root-turn.ts` evaluates before the turn starts). A channel
//      BOUND to a workspace takes a second runner
//      (`run-workspace-channel-turn.ts`) which resolves the same semantics
//      through `resolveBackgroundTurnSettings` (`job.permissionMode ?? row ??
//      DEFAULT_SESSION_MODE`) — same D1 rule, its own expression, and NOT
//      covered here: that path was still in flight when this suite landed.
//   2. the channel REPLY path's card class — the tool the model answers with
//      must never be able to acquire an approval, or a turn could card on the
//      very act of speaking back.
//
// The neighbouring links already have owners and are NOT duplicated here:
//   - `auto` allows every tool incl. the floor -> `channel-turn-auto-mode.test.ts`
//     (packages/providers/src/claude/approvals)
//   - the card push to a DM sender / its suppression in a group room ->
//     `packages/channels/src/inbound/process-inbound-message.test.ts`
//   - the BT4 wall clock on every channel turn -> `channels-service.test.ts`
//   - the bounded `ask_user` + its Telegram nudge ->
//     `run-global-root-turn.test.ts` + `consume-ask-created-event.test.ts`
//   - the unanswered-card reaper -> `recover-stale-pending-approvals.test.ts`
//
// Real SQLite throughout (`withTestDatabase`); the DB is never mocked.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import {
  insertChatSession,
  findChatSessionById,
  type NewChatSession,
} from '@vynel/chat/repositories'
import { resolveTurnSessionSettings } from '@vynel/chat'
import { DEFAULT_SESSION_MODE, toPermissionMode } from '@vynel/session'
import { TOOL_CATALOG_SNAPSHOT } from '@vynel/contracts/generated/tool-catalog-snapshot'
import { TOOL_CARD_CLASSES } from '@vynel/contracts/tool-policy/catalog'
import type { Database } from '@vynel/db'
import type { ChatSessionSelectedMode } from '@vynel/chat/repositories'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Channel Owner',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
}

/** The GLOBAL root's head segment — `workspaceId` null, scope 'global'. This is
 *  the row `run-global-root-turn` reads the channel turn's settings from. */
function makeGlobalHead(
  userId: string,
  sessionMode: ChatSessionSelectedMode | null,
): NewChatSession {
  const now = new Date()
  return {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId: null,
    providerId: 'claude',
    title: 'Global',
    scope: 'global',
    sessionMode,
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  }
}

/** The runner's line — `run-global-root-turn.ts`:
 *    toPermissionMode(resolveTurnSessionSettings({ model }, globalRow).mode ?? DEFAULT_SESSION_MODE)
 *  reproduced over the REAL row so a change to either ingredient (the resolver's
 *  precedence, or the shared default) reds here. */
function resolveChannelTurnPermissionMode(db: Database, globalHeadId: string | null): string {
  const globalRow = globalHeadId !== null ? findChatSessionById(db, globalHeadId) : null
  const settings = resolveTurnSessionSettings({}, globalRow)
  return toPermissionMode(settings.mode ?? DEFAULT_SESSION_MODE)
}

describe('the channel turn resolves its permission mode (session-hardening D1/D3)', () => {
  it('DEFAULT_SESSION_MODE is `auto` — the one default every runner falls back to', () => {
    expect(DEFAULT_SESSION_MODE).toBe('auto')
    expect(toPermissionMode(DEFAULT_SESSION_MODE)).toBe('auto')
  })

  it("a FIRST channel turn (no global head to resume yet) runs `auto` — never the unattended gate", async () => {
    await withTestDatabase((db) => {
      expect(resolveChannelTurnPermissionMode(db, null)).toBe('auto')
    })
  })

  it('a global head with NO stored mode runs `auto` (the user never picked)', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const head = insertChatSession(db, makeGlobalHead(user.id, null))
      expect(head.sessionMode).toBeNull()
      expect(resolveChannelTurnPermissionMode(db, head.id)).toBe('auto')
    })
  })

  it('a global head storing `auto` runs `auto`', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const head = insertChatSession(db, makeGlobalHead(user.id, 'auto'))
      expect(resolveChannelTurnPermissionMode(db, head.id)).toBe('auto')
    })
  })

  it('a global head storing `bypass` runs `bypass` — also uncarded', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const head = insertChatSession(db, makeGlobalHead(user.id, 'bypass'))
      expect(resolveChannelTurnPermissionMode(db, head.id)).toBe('bypass')
    })
  })

  // KNOWN EXPOSURE, recorded here on purpose. D1: "Channels run the global row's
  // mode when set, else auto (security hardening later)." So a user who picked
  // Ask in the desktop global composer makes every subsequent Telegram turn a
  // CARDING turn. That is the shipped decision, not a regression — the card's
  // visibility is what carries the safety, and it is covered at the channels
  // layer (pushed to a DM sender; deliberately NOT posted into a group room).
  // If this ever flips to a hard `auto`, this test is the place that must change
  // along with D1.
  it('a global head storing `ask` runs `ask` — the row wins over the default (D1)', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const head = insertChatSession(db, makeGlobalHead(user.id, 'ask'))
      expect(resolveChannelTurnPermissionMode(db, head.id)).toBe('ask')
    })
  })

  it('the stored mode survives a read-back — the resolution reads a persisted row, not a cache', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const head = insertChatSession(db, makeGlobalHead(user.id, 'ask'))
      expect(findChatSessionById(db, head.id)?.sessionMode).toBe('ask')
    })
  })
})

describe('the channel REPLY path never requires an approval', () => {
  const replyTool = TOOL_CATALOG_SNAPSHOT.find(
    (entry) => entry.toolName === 'mcp__vynel__reply_to_channel',
  )

  it('`reply_to_channel` is in the catalog and carries cardClass `never`', () => {
    expect(replyTool).toBeDefined()
    // A card here would mean the model cannot even SPEAK back without a
    // decision the Telegram user may not be able to make.
    expect(replyTool?.cardClass).toBe('never')
  })

  it('`reply_to_channel` is offered on the channel surface', () => {
    expect(replyTool?.surfaces).toContain('global-channel')
  })

  it('the whole channel-turn surface declares no `always` card class', () => {
    // `always` cards in EVERY mode that can card — the one class that could
    // park a channel turn regardless of what the global row says. NOTE: no tool
    // in the catalog declares it TODAY, so the emptiness assertion alone would
    // pass vacuously. The subset assertion below is the one with teeth: it
    // fails the moment a channel-surface tool declares anything outside the two
    // classes this arc reasoned about.
    expect(TOOL_CARD_CLASSES).toContain('always')
    const channelTools = TOOL_CATALOG_SNAPSHOT.filter((entry) =>
      entry.surfaces.includes('global-channel'),
    )
    expect(channelTools.length).toBeGreaterThan(0)
    const classesInUse = [...new Set(channelTools.map((entry) => entry.cardClass))].sort()
    expect(classesInUse).toEqual(['ask', 'never'])
  })
})
