// `listInFlightDelegations` — the user's currently-running delegations (brain-tree Ch3.5),
// shaped for the /global "Vynel is processing…" indicator. A thin read over the
// orchestration repo's in-flight query (`pending` + `claimed`), mapped to the light DTO the
// indicator needs — partialSessionId (so the line can open the live trace), the workspace
// name (the label), and the status. Tenant-scoped by `userId`.

import type { Database } from '@vynel/db'
import { listInFlightDelegationsForUser } from '../repositories/index.js'

export interface InFlightDelegation {
  /** The delegation's correlation key — opens its live trace panel. Null only in the
   *  (Ch2-precluded) case of a job with no key; the indicator still counts it as live work. */
  partialSessionId: string | null
  /** The target workspace's name — the indicator label. */
  workspaceName: string
  status: 'pending' | 'claimed'
}

export function listInFlightDelegations(
  db: Database,
  input: { userId: string },
): InFlightDelegation[] {
  // Map EVERY in-flight job — never drop one (a dropped job would make the liveness signal
  // read idle while work runs). The status cast is sound: the repo query filters status to
  // `pending` | `claimed`.
  return listInFlightDelegationsForUser(db, input.userId).map((job) => ({
    partialSessionId: job.partialSessionId,
    workspaceName: job.workspaceName,
    status: job.status as 'pending' | 'claimed',
  }))
}
