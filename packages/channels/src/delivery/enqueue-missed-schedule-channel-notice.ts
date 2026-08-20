// The CHANNEL leg of a missed schedule slot (schedule-gaps G1). A schedule
// whose destination is chat-and-channel pushes every fire to its channel; a
// slot Vynel was not running for is exactly the moment the user is waiting on
// that channel for something that never arrived — so it says so there too.
//
// Not a second "consumer": `schedule.run-missed` has ONE registry entry (core's
// only composite) that calls the chat notice and this. `schedules` never writes
// into channels' tables — it publishes the event; this reacts. sync.
//
// This leg owns only the WORDS; the outbound row shape is the shared
// `enqueueSchedulePushToChannel` home, alongside a fired schedule's result.

import { composeMissedScheduleNotice } from '@vynel/contracts/schedules/missed-schedule-notice'
import { enqueueSchedulePushToChannel } from './enqueue-schedule-push-to-channel.js'
import type { Database } from '@vynel/db'

// The fields of the `schedule.run-missed` payload this leg reads — the loose
// cross-domain contract, re-declared field-for-field with the producer.
export interface MissedScheduleChannelNoticeInput {
  /** The channel to tell. Null (chat-only, or none bound) never reaches here. */
  channelId: string
  scheduleDisplayName: string
  missedAtLocal: string
  nextFireAtLocal: string | null
}

export function enqueueMissedScheduleChannelNotice(
  db: Database,
  input: MissedScheduleChannelNoticeInput,
): void {
  enqueueSchedulePushToChannel(db, {
    channelId: input.channelId,
    // The SAME words the chat notice carries (one home, in contracts).
    messageBody: composeMissedScheduleNotice({
      scheduleDisplayName: input.scheduleDisplayName,
      missedAtLocal: input.missedAtLocal,
      nextFireAtLocal: input.nextFireAtLocal,
    }),
  })
}
