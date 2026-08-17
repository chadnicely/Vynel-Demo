// Pins the `vynel-session` descriptor: its declared inventory (the policy
// catalog reads it), how the compose context maps onto the tool's scope (the
// stable primary id, the ground, the LAZY chat id, the swap threshold), and
// the tool response — a real-SQLite `whoami` answer through the descriptor's
// own scope resolution.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { insertPrimarySession } from '../repositories/index.js'
import {
  buildSessionFeatureDescriptor,
  resolveWhoamiScope,
  SESSION_PROMPT_INSTRUCTIONS,
  WHOAMI_TOOL_NAME,
} from './session-mcp-feature-descriptor.js'
import { buildWhoamiResponse } from './whoami-tool.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

const noopAppRequest: SessionToolContext['appRequest'] = () =>
  Promise.resolve(new Response(null, { status: 204 }))

describe('vynel-session descriptor', () => {
  it('declares its inventory, never cards, and carries the one standing prompt line', () => {
    const descriptor = buildSessionFeatureDescriptor()
    expect(descriptor.serverName).toBe('vynel-session')
    expect(descriptor.toolNames).toEqual([WHOAMI_TOOL_NAME])
    expect(WHOAMI_TOOL_NAME).toBe('mcp__vynel-session__whoami')
    expect(descriptor.mutatingToolNames).toEqual([])
    expect(descriptor.askModeApprovalToolNames).toBeUndefined()
    expect(descriptor.contributePrompt?.({} as never)).toBe(SESSION_PROMPT_INSTRUCTIONS)
  })

  it('maps the compose context onto the tool scope: primary id, ground, lazy chat id, threshold', () => {
    const chat: { id: string | undefined } = { id: undefined }
    const context: SessionToolContext = {
      db: {},
      userId: 'u-1',
      workspaceId: 'w-1',
      sessionId: 'primary-1',
      resolveChatSessionId: () => chat.id,
      appRequest: noopAppRequest,
    }
    const scope = resolveWhoamiScope(context, { swapThreshold: 0.05 })
    expect(scope).toMatchObject({ userId: 'u-1', primarySessionId: 'primary-1', workspaceId: 'w-1', swapThreshold: 0.05 })
    // Lazy: the chat id is read at CALL time, not captured at compose time.
    expect(scope.resolveChatSessionId?.()).toBeUndefined()
    chat.id = 'seg-9'
    expect(scope.resolveChatSessionId?.()).toBe('seg-9')
    // Nothing known → nothing claimed (a plain conversation).
    const bare = resolveWhoamiScope({ db: {}, userId: 'u-1', appRequest: noopAppRequest }, {})
    expect(bare).toEqual({ userId: 'u-1' })
  })

  it('answers whoami through the descriptor scope — the global brain reads its own identity', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const now = new Date()
      const primary = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: null,
        scope: 'global',
        currentSdkSessionId: null,
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      const scope = resolveWhoamiScope(
        { db, userId: user.id, sessionId: primary.id, appRequest: noopAppRequest },
        {},
      )
      const response = buildWhoamiResponse(db, scope)
      const report = JSON.parse(response.content[0]!.text) as { kind: string; identity: string; dutyBook: { slug: string; exists: boolean } }
      expect(report.kind).toBe('global')
      expect(report.identity).toContain('the global assistant')
      expect(report.dutyBook.slug).toBe('duty-global-root')
      expect(typeof report.dutyBook.exists).toBe('boolean')
    })
  })

  it('builds a real in-process server named vynel-session', () => {
    const server = buildSessionFeatureDescriptor().build({
      db: {},
      userId: 'u-1',
      appRequest: noopAppRequest,
    })
    expect(server).not.toBeNull()
    expect((server as { name: string }).name).toBe('vynel-session')
  })
})
