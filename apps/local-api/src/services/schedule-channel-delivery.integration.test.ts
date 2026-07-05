// Cross-domain wiring guard for the headline "scheduled reminder → Telegram DM"
// promise. Relocated to the app composition layer — the ONE place that composes
// both leaves — because the contract spans two decoupled packages that never
// import each other: `@vynel/schedules` FIRES a schedule and publishes the
// `schedule.run-completed` outbox event; `@vynel/channels` CONSUMES that event
// and enqueues an outbound row to the channel's owner.
//
// The two leaves are NOT type-linked (schedules builds the payload as a literal;
// channels types it via its own `ScheduleRunCompletedPayload`), so a drift would
// otherwise pass typecheck. THIS test exercises the real chain end-to-end with a
// real DB: fire (verbatim reminder — no LLM turn, `stubFireDeps`'s no-op turn is
// never called) → read the REAL emitted outbox event → hand it to the channels
// consumer → assert the enqueued outbound row via the channels test-support
// reader. The generic outbox RELAY is not built yet, so the consume step is
// invoked directly — exactly as the source integration test did.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { manualFireSchedule, SCHEDULE_RUN_COMPLETED_EVENT_TYPE } from '@vynel/schedules'
import { insertSchedule, stubFireDeps } from '@vynel/schedules/test-support'
import {
  consumeScheduleRunCompletedEvent,
  type ScheduleRunCompletedPayload,
} from '@vynel/channels'
import {
  seedChannelWithAllowedSender,
  listOutboundMessagesForChannel,
} from '@vynel/channels/test-support'

describe('scheduled reminder → channel DM (schedules ↔ channels delivery contract)', () => {
  it('fires a chat-and-channel reminder and enqueues its output to the channel’s owner', async () => {
    await withTestDatabase(async (db) => {
      // The profiled user: a Telegram channel + an allowed sender (the owner).
      const { user, workspace, channel, sender } = seedChannelWithAllowedSender(db)

      // A verbatim reminder aimed at that channel, under the same owner. Verbatim
      // fires WITHOUT an LLM turn — the rendered prompt is delivered as-is — so
      // the fire path needs no real `startChatTurn`.
      const now = new Date()
      const schedule = insertSchedule(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        templateKind: 'reminder',
        scheduleKind: 'recurring',
        displayName: 'Meeting reminder',
        cronExpression: '0 14 * * *',
        timezone: 'UTC',
        promptTemplate: 'Attend your 2pm meeting.',
        destinationKind: 'chat-and-channel',
        channelId: channel.id,
        catchUpOnMiss: false,
        isEnabled: true,
        approvalTimeoutMsOverride: null,
        lastFiredAt: null,
        nextScheduledFireAt: null,
        createdAt: now,
        updatedAt: now,
      })

      // 1) Fire → publishes the REAL schedule.run-completed outbox event.
      const run = await manualFireSchedule(
        db,
        { scheduleId: schedule.id, userId: user.id },
        stubFireDeps(),
      )
      expect(run.status).toBe('completed')

      const [event] = listOutboxEventsByType(db, SCHEDULE_RUN_COMPLETED_EVENT_TYPE)
      expect(event).toBeDefined()
      // The outbox stores a deliberately-opaque payload; this cast IS the
      // cross-domain contract under test (schedules' literal vs channels' type).
      const emittedPayload = event!.payload as unknown as ScheduleRunCompletedPayload
      expect(emittedPayload.channelId).toBe(channel.id)

      // 2) Channels consumes the REAL emitted payload → enqueues to the owner.
      consumeScheduleRunCompletedEvent(db, emittedPayload)

      // 3) The outbound row landed on the profiled user, body intact (📅 header
      //    baked in by the schedules render; channels enqueues it verbatim).
      const outbound = listOutboundMessagesForChannel(db, channel.id)
      expect(outbound).toHaveLength(1)
      expect(outbound[0]?.payloadKind).toBe('scheduled-message')
      expect(outbound[0]?.externalRecipientId).toBe(sender.externalSenderId)
      expect(outbound[0]?.status).toBe('pending')
      expect(outbound[0]?.messageBody).toContain('Attend your 2pm meeting.')
      expect(outbound[0]?.messageBody).toContain('📅')
    })
  })
})
