// End-to-end over the REAL registry: a published event → dispatch → the
// consumer's side effect. Pins that the registry actually carries the two
// live consumers (an empty registry made every published event sit
// unprocessed forever — the pre-relay state).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertOutboxEvent, listUnprocessedOutboxEvents } from '@vynel/db/repositories/_shared'
import {
  listOutboundMessagesForChannel,
  seedChannelWithAllowedSender,
} from '@vynel/channels/test-support'
import { dispatchOutboxEvents } from './dispatch-outbox-events.js'
import { OUTBOX_CONSUMERS } from './outbox-consumer-registry.js'

describe('OUTBOX_CONSUMERS (real registry)', () => {
  // test: correct expectation — `schedule.run-failed` joined the registry
  // (a failed schedule run now routes into a global-root report delivery),
  // then `task.created` (the pickup nudge, task-execution arc 2026-08-18),
  // then `schedule.run-missed` (schedule-gaps G1 — a slot nobody was told
  // about; the one entry that drives TWO reactions).
  it('registers the five live consumers', () => {
    expect(Object.keys(OUTBOX_CONSUMERS).sort()).toEqual([
      'ask.created',
      'schedule.run-completed',
      'schedule.run-failed',
      'schedule.run-missed',
      'task.created',
    ])
  })

  it('dispatch relays a published schedule.run-failed into a report-delivery job', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      insertOutboxEvent(db, {
        id: randomUUID(),
        type: 'schedule.run-failed',
        payload: {
          scheduleId: 'sched-1',
          runId: 'run-1',
          userId: channel.userId,
          workspaceId: channel.workspaceId,
          scheduleDisplayName: 'Morning brief',
          errorMessage: 'workspace not found',
          firedAt: new Date().toISOString(),
        },
        createdAt: new Date(),
        processedAt: null,
      })

      const result = dispatchOutboxEvents(db)
      expect(result).toEqual({ dispatched: 1, failed: 0 })
      expect(
        listUnprocessedOutboxEvents(db, { types: ['schedule.run-failed'], limit: 10 }),
      ).toHaveLength(0)
    })
  })

  it('dispatch relays a published schedule.run-missed into BOTH legs, exactly once', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const publish = () =>
        insertOutboxEvent(db, {
          id: randomUUID(),
          type: 'schedule.run-missed',
          payload: {
            scheduleId: 'sched-1',
            runId: 'run-1',
            userId: channel.userId,
            workspaceId: null,
            channelId: channel.id,
            scheduleDisplayName: 'Tea',
            missedAtLocal: 'Aug 21, 2026, 5:00 PM',
            nextFireAtLocal: 'Aug 22, 2026, 5:00 PM',
            missedAt: new Date().toISOString(),
          },
          createdAt: new Date(),
          processedAt: null,
        })

      publish()
      expect(dispatchOutboxEvents(db)).toEqual({ dispatched: 1, failed: 0 })

      // The channel leg fired beside the chat one (the composite entry).
      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]?.messageBody).toContain('missed its Aug 21, 2026, 5:00 PM run')

      // Processed exactly once — a second tick finds nothing to redeliver.
      expect(dispatchOutboxEvents(db)).toEqual({ dispatched: 0, failed: 0 })
      expect(listOutboundMessagesForChannel(db, channel.id)).toHaveLength(1)
      expect(
        listUnprocessedOutboxEvents(db, { types: ['schedule.run-missed'], limit: 10 }),
      ).toHaveLength(0)
    })
  })

  it('dispatch relays a published ask.created into an ask-nudge outbound message', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      insertOutboxEvent(db, {
        id: randomUUID(),
        type: 'ask.created',
        payload: {
          askId: 'ask-1',
          userId: channel.userId,
          workspaceId: channel.workspaceId,
          questionCount: 2,
          firstQuestionLabel: 'Which tone?',
          createdAt: new Date().toISOString(),
        },
        createdAt: new Date(),
        processedAt: null,
      })

      const result = dispatchOutboxEvents(db)
      expect(result).toEqual({ dispatched: 1, failed: 0 })

      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('ask-nudge')
      // Processed exactly once — a second tick finds nothing.
      expect(
        listUnprocessedOutboxEvents(db, { types: ['ask.created'], limit: 10 }),
      ).toHaveLength(0)
    })
  })
})
