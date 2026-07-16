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
  it('registers the two live consumers', () => {
    expect(Object.keys(OUTBOX_CONSUMERS).sort()).toEqual(['ask.created', 'schedule.run-completed'])
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
