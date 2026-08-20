// The `schedule.run-completed` outbox CONSUMER (the locked schedules ↔
// channels contract — §9). When `schedules` publishes a fired schedule
// destined for a channel, channels enqueues a `scheduled-message` outbound
// row to the channel's owner. `schedules` NEVER writes into channels'
// tables — it publishes the event; this function reacts. sync.
//
// SCOPE (OQ-5 / D19): this domain owns ONLY the consumer function + the
// payload shape + the `scheduled-message` payload kind. The generic outbox
// DISPATCH/RELAY (unprocessed-query + mark-processed + the poll-and-invoke
// loop + the event-type→consumer registry) is shared infrastructure wired
// when `schedules` builds — it is deliberately NOT fabricated here (no such
// infra exists on disk yet; inventing it would trip the "don't invent
// cross-cutting infra" Gate-1).
//
// The outbound row shape is the shared `enqueueSchedulePushToChannel` home,
// alongside the missed-slot notice; this consumer owns only the payload it
// reads and the text it pushes.
//
// Spec: `docs/blueprints/channels/blueprint.md §9`.

import { enqueueSchedulePushToChannel } from './enqueue-schedule-push-to-channel.js'
import type { Database } from '@vynel/db'

// Field-for-field the payload `schedules` publishes (the 📅 header is baked
// into `renderedOutput`; channels enqueues it verbatim).
export interface ScheduleRunCompletedPayload {
  scheduleId: string
  userId: string
  // Nullable, field-for-field with the schedules producer — a GLOBAL schedule
  // (NULL workspace) can still deliver to a channel. Not read here (delivery
  // keys off channelId), kept accurate for the loose cross-domain contract.
  workspaceId: string | null
  channelId: string
  // The chat session the fired turn produced — carried for traceability, not
  // used for delivery. Null for a verbatim reminder (no LLM turn, no session).
  chatSessionId: string | null
  renderedOutput: string
  firedAt: string // ISO
}

export function consumeScheduleRunCompletedEvent(
  db: Database,
  payload: ScheduleRunCompletedPayload,
): void {
  enqueueSchedulePushToChannel(db, {
    channelId: payload.channelId,
    messageBody: payload.renderedOutput,
  })
}
