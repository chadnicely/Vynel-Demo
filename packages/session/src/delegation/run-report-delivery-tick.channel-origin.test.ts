// The channel report protocol's second half (Kafi 2026-08-22): THE REQUESTER
// ANSWERS THE CHANNEL. A delivery row about work a channel asked for carries
// that channel's origin, and the notify turn is given everything it needs to
// reply there — the ambient address (never model input), the answer marker on
// the message, and the reply tool's own surface. Plus the last resort: when the
// delivery dies terminally, the report goes to the channel rather than nowhere.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  enqueueReportDelivery,
  failDelegationJob,
  findDelegationJobById,
  type DelegationOrigin,
} from '@vynel/orchestration'
import { insertChannel, listOutboundMessagesForChannel } from '@vynel/channels/test-support'
import { listChatMessagesForSession } from '@vynel/chat/repositories'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { deliverReportFailsafeToChannel } from './deliver-report-failsafe-to-channel.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string, name = 'Acme') {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name,
    managerName: 'Mark',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function seedTelegramChannel(
  db: Database,
  userId: string,
  workspaceId: string | null,
  isEnabled = true,
) {
  const now = new Date()
  return insertChannel(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    channelKind: 'telegram',
    displayName: 'Bot',
    botCredentials: JSON.stringify({ botToken: 't' }),
    botMetadata: '{}',
    connectionStatus: 'healthy',
    connectionStatusMessage: null,
    lastPolledCursor: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled,
    createdAt: now,
    updatedAt: now,
  })
}

function originFor(channelId: string): DelegationOrigin {
  return { channelId, externalSenderId: 'tg-42', externalChatContextId: 'chat-7' }
}

describe('a channel-origin report delivery — the GLOBAL requester', () => {
  it('hands the notify turn the origin, the channel kind, and the answer marker', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = seedTelegramChannel(db, user.id, null)
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Three docs, all current.',
        requester: { kind: 'global-root' },
        origin: originFor(channel.id),
      })

      const calls: Array<Record<string, unknown>> = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          calls.push(input as unknown as Record<string, unknown>)
          return { sessionId: 'root-sdk-1', resultText: 'told them' }
        },
      })

      expect(calls).toHaveLength(1)
      // The ADDRESS is ambient — the turn's `reply_to_channel` reads it from
      // the server, never from anything the model chose.
      expect(calls[0]?.origin).toEqual(originFor(channel.id))
      // The marker says a person is waiting and how to answer — and it rides
      // PROVIDER input only. The report BODY (which becomes the user's
      // transcript row) must stay clean: they are not its audience.
      expect(calls[0]?.channelReplyMarker).toContain('reply_to_channel')
      expect(calls[0]?.channelReplyMarker).toContain('TELEGRAM')
      expect(calls[0]?.reportBody).toContain('Three docs, all current.')
      expect(calls[0]?.reportBody).not.toContain('reply_to_channel')
    })
  })

  it('carries NO origin when no channel drove the work — the chat path, unchanged', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Three docs, all current.',
        requester: { kind: 'global-root' },
      })

      const calls: Array<Record<string, unknown>> = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          calls.push(input as unknown as Record<string, unknown>)
          return { sessionId: 'root-sdk-1', resultText: 'noted' }
        },
      })

      expect(calls[0]?.origin).toBeUndefined()
      expect(calls[0]?.channelReplyMarker).toBeUndefined()
    })
  })

  it('stays silent about the channel when it is DISABLED — no tool call that would 400', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      // The user turned the bot off between the task and its report.
      const channel = seedTelegramChannel(db, user.id, null, false)
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Three docs, all current.',
        requester: { kind: 'global-root' },
        origin: originFor(channel.id),
      })
      const calls: Array<Record<string, unknown>> = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          calls.push(input as unknown as Record<string, unknown>)
          return { sessionId: 'root-sdk-1', resultText: 'noted' }
        },
      })

      expect(calls[0]?.channelReplyMarker).toBeUndefined()
    })
  })
})

describe('a channel-origin report delivery — the WORKSPACE requester', () => {
  it('stamps the origin onto the notify turn’s MCP composition (its reply tool’s address)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const requester = insertWorkspace(db, makeWorkspace(user.id, 'Asker'))
      const channel = seedTelegramChannel(db, user.id, requester.id)
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Acme research',
        reportBody: 'Backlog has 4 stale items.',
        requester: {
          kind: 'workspace-primary',
          workspaceId: requester.id,
          workspacePath: requester.path,
        },
        origin: originFor(channel.id),
      })

      const composerInputs: Array<Record<string, unknown>> = []
      const startInputs: Array<{ userMessageText: string }> = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'asker-sdk-1',
          resultText: 'passed it on',
          startChatSessionInputs: startInputs as never,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        composeWorkspaceMcpServers: (input) => {
          composerInputs.push(input as unknown as Record<string, unknown>)
          return {
            mcpServers: {},
            deniedMcpToolPatterns: [],
            mutatingToolNames: [],
            askModeApprovalToolNames: [],
            systemPromptAppend: '',
          }
        },
      })

      expect(composerInputs).toHaveLength(1)
      expect(composerInputs[0]?.target).toBe('workspace-root')
      expect(composerInputs[0]?.origin).toEqual(originFor(channel.id))
      // The turn's PROVIDER input carries the answer marker — the workspace is
      // the one who talks to the person, exactly like the root would…
      expect(startInputs[0]?.userMessageText).toContain('reply_to_channel')
      expect(startInputs[0]?.userMessageText).toContain('Backlog has 4 stale items.')
      // …and the row the USER reads does not.
      expect(
        listChatMessagesForSession(db, 'asker-sdk-1').map((m) => m.body),
      ).not.toContainEqual(expect.stringContaining('reply_to_channel'))
    })
  })
})

describe('the last-resort failsafe — report delivery itself died', () => {
  it('ships the report to the origin channel, addressed to the chat that asked', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = seedTelegramChannel(db, user.id, null)
      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Three docs, all current.',
        requester: { kind: 'global-root' },
        origin: originFor(channel.id),
      })
      failDelegationJob(db, jobId, 'the notify turn never completed', new Date())

      expect(
        deliverReportFailsafeToChannel(db, findDelegationJobById(db, jobId)!, {
          logger: silentLogger,
        }),
      ).toBe(true)
      expect(listOutboundMessagesForChannel(db, channel.id)).toMatchObject([
        {
          externalRecipientId: 'tg-42',
          externalChatContextId: 'chat-7',
          messageBody: 'Three docs, all current.',
          payloadKind: 'chat-stream-final',
        },
      ])
    })
  })

  it('fires from the TICK when a global delivery has no runner to fail over to', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = seedTelegramChannel(db, user.id, null)
      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Three docs, all current.',
        requester: { kind: 'global-root' },
        origin: originFor(channel.id),
      })

      // No `runGlobalRootReportTurn` wired: the delivery throws and settles
      // terminally — the one shape where the user would otherwise hear nothing.
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })

      expect(findDelegationJobById(db, jobId)?.status).toBe('failed')
      expect(
        listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody),
      ).toEqual(['Three docs, all current.'])
    })
  })

  it('does nothing for a delivery with no origin channel — there is nobody waiting', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = seedTelegramChannel(db, user.id, null)
      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Three docs, all current.',
        requester: { kind: 'global-root' },
      })

      expect(
        deliverReportFailsafeToChannel(db, findDelegationJobById(db, jobId)!, {
          logger: silentLogger,
        }),
      ).toBe(false)
      expect(listOutboundMessagesForChannel(db, channel.id)).toEqual([])
    })
  })
})
