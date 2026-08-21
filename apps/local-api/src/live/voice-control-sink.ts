// The api's half of the voice-control seam: one of the user's windows tells the
// others something only it can see, and the live-channel hub fans it to every
// `voice:*` subscription that user holds.
//
// The sink exists so the ROUTE stays a route (parse → validate → call → shape)
// and can be handed a recorder in a test instead of a whole hub. Thin on
// purpose, exactly like `display-live-sink`: the hub owns the fan-out, the
// memo, and turning a dead socket into a close rather than a throw.

import type { VoiceControlEvent } from '@vynel/contracts/voice/daemon-events'
import type { LiveChannelHub } from '@vynel/session/runtime'

export interface VoiceControlSink {
  /** Never throws — a broken window must not fail the window that spoke. */
  publish(userId: string, frame: VoiceControlEvent): void
}

export function createHubVoiceControlSink(hub: LiveChannelHub): VoiceControlSink {
  return {
    publish: (userId, frame) => hub.publishVoiceControl(userId, frame),
  }
}
