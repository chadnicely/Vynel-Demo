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
   *  routed turn streams rows into it. Null for a SESSION-target job (Slice ④ —
   *  no workspace view polls it; the Sessions panel watches it instead). */
  workspaceId: string | null
  /** The indicator label: the target workspace's name, or the generic 'Session'
   *  for a session-target job (orchestration can't read the session's name —
   *  that's the session package's table; the session tier's
   *  attachSpawnedSessionNames decorates the real name at serve time). */
  workspaceName: string
  /** A SESSION-target job's spawned primary — null for workspace targets. The
   *  session tier resolves its display name off this (loose cross-feature ref,
   *  same as the column itself). */
  targetPrimarySessionId: string | null
  /** The task, as a short human label — the indicator names the actual work
   *  ("vynel · Set up the login page"), never a canned "Working…". */
  taskLabel: string
  status: 'pending' | 'claimed'
  /** Work kind — 'agent-run' rows are colleague mentions (the rail wears the
   *  agent badge on them, redesign Q4); legacy NULL reads as 'task'. Delivery
   *  kinds never reach this list (B7's work-kind gate). */
  jobKind: 'task' | 'agent-run'
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
    workspaceName: job.workspaceName ?? 'Session',
    targetPrimarySessionId: job.targetPrimarySessionId,
    taskLabel: deriveDelegationTaskLabel(job.taskText),
    status: job.status as 'pending' | 'claimed',
    jobKind: job.jobKind === 'agent-run' ? 'agent-run' : 'task',
  }))
}
