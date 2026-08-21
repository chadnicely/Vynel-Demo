// Lift a job row's three origin-channel columns back into the `DelegationOrigin`
// shape enqueue ops take. They are written as a UNIT (all three or none), so a
// partial row is a corrupt row and answers null.
//
// NOT `resolveDeliverableOrigin` (`@vynel/session`): that one also loads the
// channel and checks it exists, is enabled and is owned — it answers "can this
// be DELIVERED right now". This one is a pure column read: "which channel did
// this job come from", the value a downstream job row (a continuation, a report
// delivery) must carry forward so the answer can find its way home later.

import type { DelegationJob } from '../repositories/index.js'
import type { DelegationOrigin } from './enqueue-workspace-delegation.js'

export function readDelegationJobOrigin(job: DelegationJob): DelegationOrigin | null {
  if (
    job.originChannelId === null ||
    job.originExternalSenderId === null ||
    job.originExternalChatContextId === null
  ) {
    return null
  }
  return {
    channelId: job.originChannelId,
    externalSenderId: job.originExternalSenderId,
    externalChatContextId: job.originExternalChatContextId,
  }
}
