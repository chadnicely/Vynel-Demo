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
  enqueueWorkspaceDelegation,
  failDelegationJob,
  findDelegationJobById,
  requeueDelegationJob,
  type DelegationOrigin,
} from '@vynel/orchestration'
import { enqueueChannelReply, SILENT_CHANNEL_TURN_FALLBACK } from '@vynel/channels'
import { insertChannel, listOutboundMessagesForChannel } from '@vynel/channels/test-support'
import { listChatMessagesForSession } from '@vynel/chat/repositories'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { deliverReportFailsafeToChannel } from './deliver-report-failsafe-to-channel.js'
import {
  AUTO_REPORT_MARKER,
  composeReportWithAssistantNotes,
  enqueueAutoReportDelivery,
} from './enqueue-job-report-delivery.js'

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
      const jobId = enqueueReportDelivery(db, {
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
      // the server, never from anything the model chose. It carries THIS
      // delivery row's id as the turn key, so a reply this turn queues can be
      // told from a concurrent inbound turn's in the same chat.
      expect(calls[0]?.origin).toEqual({ ...originFor(channel.id), turnCorrelationId: jobId })
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
      const jobId = enqueueReportDelivery(db, {
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
      expect(composerInputs[0]?.origin).toEqual({
        ...originFor(channel.id),
        turnCorrelationId: jobId,
      })
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

describe('the failsafe ships what a PERSON can read, never model-directed text', () => {
  it('drops the auto-report marker line — the sender gets the result, not the relay note', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = seedTelegramChannel(db, user.id, null)
      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: `${AUTO_REPORT_MARKER}\n\nThree docs, all current.`,
        requester: { kind: 'global-root' },
        origin: originFor(channel.id),
      })
      failDelegationJob(db, jobId, 'the notify turn never completed', new Date())

      deliverReportFailsafeToChannel(db, findDelegationJobById(db, jobId)!, {
        logger: silentLogger,
      })
      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        'Three docs, all current.',
      ])
    })
  })

  it('an EMPTY auto-report ships its sender sentence, not the assistant’s next step', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const channel = seedTelegramChannel(db, user.id, null)
      // The engine's own stand-in for a channel-driven task that finished
      // wordlessly — the one auto-report body written entirely FOR a model.
      const workJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'root-sdk-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'file the receipts',
        origin: originFor(channel.id),
      })
      const deliveryId = enqueueAutoReportDelivery(db, findDelegationJobById(db, workJobId)!, '   ')
      failDelegationJob(db, deliveryId, 'the notify turn never completed', new Date())

      deliverReportFailsafeToChannel(db, findDelegationJobById(db, deliveryId)!, {
        logger: silentLogger,
      })
      const [shipped] = listOutboundMessagesForChannel(db, channel.id)
      expect(shipped?.messageBody).toBe(
        'Sorry — "file the receipts" finished without producing anything I can pass on.',
      )
      expect(shipped?.messageBody).not.toContain('Check with the user')
    })
  })

  it('ships the failure sentence only — no retry instruction, no raw <error>', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = seedTelegramChannel(db, user.id, null)
      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: composeReportWithAssistantNotes({
          senderSentence: "Sorry — I couldn't finish \"file the receipts\". The details are in the app.",
          assistantNotes:
            'The background task "file the receipts" failed after 2 attempts: ' +
            '<error>ENOENT: no such file</error>. Tell the user it failed, and re-send it ' +
            'with send_message if it should run again.',
        }),
        requester: { kind: 'global-root' },
        origin: originFor(channel.id),
      })
      failDelegationJob(db, jobId, 'the notify turn never completed', new Date())

      deliverReportFailsafeToChannel(db, findDelegationJobById(db, jobId)!, {
        logger: silentLogger,
      })
      const [shipped] = listOutboundMessagesForChannel(db, channel.id)
      expect(shipped?.messageBody).toBe(
        "Sorry — I couldn't finish \"file the receipts\". The details are in the app.",
      )
      expect(shipped?.messageBody).not.toContain('<error>')
      expect(shipped?.messageBody).not.toContain('send_message')
    })
  })
})

describe('the failsafe fires only when THIS run really owns the terminal failure', () => {
  it('stands down when the claim was settled elsewhere — no second copy of one answer', async () => {
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

      // Heartbeat starvation, exactly: the lease sweeper hands the row back to
      // pending mid-run, then this run dies. Its fail CAS no-ops — and the
      // requeued attempt is the one that will answer the channel.
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => {
          requeueDelegationJob(db, jobId, {
            errorMessage: 'lease expired',
            errorCode: null,
            attemptCount: 0,
            nextAttemptAt: new Date(),
          })
          throw new Error('the run stopped responding')
        },
      })

      expect(findDelegationJobById(db, jobId)?.status).toBe('pending')
      expect(listOutboundMessagesForChannel(db, channel.id)).toEqual([])
    })
  })

  it('a user STOP settles the row and says nothing to the channel', async () => {
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
      const partialSessionId = findDelegationJobById(db, jobId)!.partialSessionId!
      const cancelRegistry = new DelegationCancelRegistry()

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        cancelRegistry,
        runGlobalRootReportTurn: async () => {
          cancelRegistry.requestCancel(partialSessionId)
          throw new Error('interrupted')
        },
      })

      expect(findDelegationJobById(db, jobId)?.errorMessage).toBe('stopped by the user')
      expect(listOutboundMessagesForChannel(db, channel.id)).toEqual([])
    })
  })
})

describe('the notify turn owes the sender a word too — the zero-reply net', () => {
  function seedChannelDelivery(db: Database, reportBody = 'Three docs, all current.') {
    const user = insertUser(db, makeUser())
    const channel = seedTelegramChannel(db, user.id, null)
    const jobId = enqueueReportDelivery(db, {
      userId: user.id,
      reporterSessionId: 'child-sdk-1',
      reporterLabel: 'Mark · Acme',
      reportBody,
      requester: { kind: 'global-root' },
      origin: originFor(channel.id),
    })
    return { channel, jobId }
  }

  it('stays out of the way when the turn answered through reply_to_channel', async () => {
    await withTestDatabase(async (db) => {
      const { channel, jobId } = seedChannelDelivery(db)

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => {
          // What the tool leaves behind, stamped with this turn's key.
          enqueueChannelReply(db, {
            channel,
            message: { externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
            body: 'All three are current.',
            turnCorrelationId: jobId,
          })
          return { sessionId: 'root-sdk-1', resultText: 'internal notes nobody should receive' }
        },
      })

      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        'All three are current.',
      ])
    })
  })

  it('ships the turn’s own closing text when it completed without replying', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelDelivery(db)

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => ({
          sessionId: 'root-sdk-1',
          resultText: 'All three docs are current.',
        }),
      })

      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        'All three docs are current.',
      ])
    })
  })

  it('ships the fixed line when the turn completed wordlessly', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelDelivery(db)

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => ({ sessionId: 'root-sdk-1', resultText: '   ' }),
      })

      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        SILENT_CHANNEL_TURN_FALLBACK,
      ])
    })
  })

  it('a SIBLING turn’s reply in the same chat does not silence this one', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelDelivery(db)

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => {
          // A concurrent inbound turn answering its OWN message, same chat.
          enqueueChannelReply(db, {
            channel,
            message: { externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
            body: 'Sure, on it.',
            turnCorrelationId: 'another-turn',
          })
          return { sessionId: 'root-sdk-1', resultText: 'All three docs are current.' }
        },
      })

      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        'Sure, on it.',
        'All three docs are current.',
      ])
    })
  })

  it('says nothing when no channel is waiting — the chat path, unchanged', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const channel = seedTelegramChannel(db, user.id, null)
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Three docs, all current.',
        requester: { kind: 'global-root' },
      })

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => ({ sessionId: 'root-sdk-1', resultText: '' }),
      })

      expect(listOutboundMessagesForChannel(db, channel.id)).toEqual([])
    })
  })
})
