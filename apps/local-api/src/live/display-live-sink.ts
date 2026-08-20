// The api's half of the Display push seam: `@vynel/display` publishes through
// a structural `DisplayLiveSink` (a leaf may not import `@vynel/session`), and
// here that sink is the live-channel hub.
//
// Thin on purpose — the hub owns the fan-out (which sockets belong to this
// user, which hold the `display` channel) and already turns a dead socket into
// a close rather than a throw, which is exactly the leaf's "publish MUST NOT
// throw" rule. Nothing left for an adapter to decide.

import type { DisplayLiveSink } from '@vynel/display'
import type { LiveChannelHub } from '@vynel/session/runtime'

export function createHubDisplayLiveSink(hub: LiveChannelHub): DisplayLiveSink {
  return {
    publish: (userId, frame) => hub.publishDisplayFrame(userId, frame),
  }
}
