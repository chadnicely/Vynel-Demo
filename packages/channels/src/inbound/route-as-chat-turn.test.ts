// Scope routing for an inbound chat turn: the channel's OWN `workspaceId`
// decides which conversation answers. Ch4 had made that column inert — every
// channel talked to the global brain (Kafi, live 2026-08-21) — so these pin the
// three answers: workspace channel → the workspace runner, global channel →
// the root, bound workspace gone → the root with a warn.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { workspaces } from '@vynel/db/schema/workspaces'
import { eq } from 'drizzle-orm'
import {
  seedChannel,
  insertPendingChatTurnMessage,
  stubTurnDeps,
  makeUser,
  makeWorkspace,
} from '../test-support.js'
import type { StructuralLogger } from '../channels-types.js'

// The turn sends a "typing…" indicator through the telegram adapter — mock the
// network boundary so it no-ops (the sibling inbound tests' seam).
vi.mock('telegraf', () => ({ Telegram: vi.fn(() => ({ sendChatAction: vi.fn() })) }))

const { routeAsChatTurn } = await import('./route-as-chat-turn.js')

function recordingLogger(): StructuralLogger & { warnings: { message: string }[] } {
  const warnings: { message: string }[] = []
  return {
    info: () => {},
    warn: (_object: object, message?: string) => warnings.push({ message: message ?? '' }),
    error: () => {},
    warnings,
  }
}

describe('routeAsChatTurn — the channel decides the scope', () => {
  it('runs a WORKSPACE-scoped channel on its workspace, carrying origin + marker', async () => {
    await withTestDatabase(async (db) => {
      const { channel, workspace } = seedChannel(db)
      const message = insertPendingChatTurnMessage(db, channel.id, 'how did yesterday go?')
      const deps = stubTurnDeps({ withWorkspaceTurn: true })

      await routeAsChatTurn(db, { channel, message }, deps)

      expect(deps.state.rootTurnCalls).toHaveLength(0)
      expect(deps.state.workspaceTurnCalls).toHaveLength(1)
      const call = deps.state.workspaceTurnCalls[0]!
      expect(call.workspaceId).toBe(workspace.id)
      expect(call.workspacePath).toBe(workspace.path)
      expect(call.userId).toBe(channel.userId)
      expect(call.userMessageText).toBe('how did yesterday go?')
      // The channel pipeline's own carry: the reply address, the row stamp,
      // and the per-message reply-through-the-tool instruction.
      expect(call.origin).toMatchObject({
        channelId: channel.id,
        externalSenderId: message.externalSenderId,
        externalChatContextId: message.externalChatContextId,
      })
      expect(call.originChannel).toBe('telegram')
      expect(call.channelReplyMarker).toContain('reply_to_channel')
    })
  })

  it('leaves a GLOBAL channel on the root turn, unchanged', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db, { workspaceId: null })
      const message = insertPendingChatTurnMessage(db, channel.id)
      const deps = stubTurnDeps({ withWorkspaceTurn: true })

      await routeAsChatTurn(db, { channel, message }, deps)

      expect(deps.state.workspaceTurnCalls).toHaveLength(0)
      expect(deps.state.rootTurnCalls).toHaveLength(1)
      expect(deps.state.rootTurnCalls[0]?.originChannel).toBe('telegram')
    })
  })

  it('falls back to the root — with a warn — when the bound workspace is gone', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      const message = insertPendingChatTurnMessage(db, channel.id)
      // The FK cascades a workspace delete onto its channels, so the dangling
      // state this branch defends needs the constraint stood down to reproduce
      // — the branch itself is what keeps a channel row that outlives its
      // workspace (a restore, a Phase-2 dialect without the cascade) answering
      // instead of failing the message.
      db.run(sql`PRAGMA foreign_keys = OFF`)
      db.delete(workspaces).where(eq(workspaces.id, channel.workspaceId!)).run()
      db.run(sql`PRAGMA foreign_keys = ON`)
      const logger = recordingLogger()
      const deps = { ...stubTurnDeps({ withWorkspaceTurn: true }), logger }

      await routeAsChatTurn(db, { channel, message }, deps)

      expect(deps.state.workspaceTurnCalls).toHaveLength(0)
      expect(deps.state.rootTurnCalls).toHaveLength(1)
      expect(logger.warnings.map((entry) => entry.message).join(' ')).toContain(
        'workspace that is gone',
      )
    })
  })

  it("falls back to the root when the bound workspace belongs to somebody else", async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      const stranger = insertUser(db, makeUser())
      const strangersWorkspace = insertWorkspace(db, makeWorkspace(stranger.id))
      const message = insertPendingChatTurnMessage(db, channel.id)
      const logger = recordingLogger()
      const deps = { ...stubTurnDeps({ withWorkspaceTurn: true }), logger }

      await routeAsChatTurn(
        db,
        { channel: { ...channel, workspaceId: strangersWorkspace.id }, message },
        deps,
      )

      expect(deps.state.workspaceTurnCalls).toHaveLength(0)
      expect(deps.state.rootTurnCalls).toHaveLength(1)
      // test: correct expectation — was a bare warning COUNT, which the
      // silent-turn fallback's own warn now also lands in. Assert the warning
      // this test is about instead: the scope fallback.
      expect(logger.warnings.map((entry) => entry.message).join(' ')).toContain(
        'workspace that is gone',
      )
    })
  })

  it('keeps the root path when no workspace runner is wired', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      const message = insertPendingChatTurnMessage(db, channel.id)
      const deps = stubTurnDeps()

      await routeAsChatTurn(db, { channel, message }, deps)

      expect(deps.state.rootTurnCalls).toHaveLength(1)
    })
  })
})
