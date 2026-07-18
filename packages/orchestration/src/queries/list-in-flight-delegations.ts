// `listInFlightDelegations` — the user's currently-running delegations (brain-tree Ch3.5),
// shaped for the /global "Vynel is processing…" indicator. A thin read over the
// orchestration repo's in-flight query (`pending` + `claimed`), mapped to the light DTO the
// indicator needs — partialSessionId (so the line can open the live trace), the workspace
// name (the label), and the status. Tenant-scoped by `userId`.

import type { Database } from '@vynel/db'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'
import { listInFlightDelegationsForUser } from '../repositories/index.js'

export interface InFlightDelegation {
  /** The delegation's correlation key — opens its live trace panel. Null only in the
   *  (Ch2-precluded) case of a job with no key; the indicator still counts it as live work. */
  partialSessionId: string | null
  /** The target workspace — lets the workspace chat poll its transcript while a
   *  routed turn streams rows into it. */
  workspaceId: string
  /** The target workspace's name — the indicator label. */
  workspaceName: string
  /** The task, as a short human label — the indicator names the actual work
   *  ("vynel · Set up the login page"), never a canned "Working…". */
  taskLabel: string
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
    workspaceId: job.workspaceId,
    workspaceName: job.workspaceName,
    taskLabel: deriveDelegationTaskLabel(job.taskText),
    status: job.status as 'pending' | 'claimed',
  }))
}
