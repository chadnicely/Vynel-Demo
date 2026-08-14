// The workspace status vocabulary (redesign Arc 5b — "one status, one
// colour"). Two layers share this file:
//
//   - the ASSISTANT-SET states (`WorkspaceSetStatus`) the `set_workspace_status`
//     MCP tool writes — facts with a timestamp, superseded by any turn that
//     starts later;
//   - the EFFECTIVE status (`WorkspaceEffectiveStatus`) every navigation
//     surface renders, derived client-side in ONE home
//     (`use-workspace-status`) from the set state + turn liveness/outcome +
//     pending approvals/asks + task counts.
//
// Precedence (highest wins): problem → needs_input → running → completed →
// not_running. Detection adds: a FAILED/ORPHANED latest turn → problem; a
// pending approval/ask → needs_input; an in-flight turn → running.

export const WORKSPACE_SET_STATUSES = ['completed', 'problem', 'needs_input'] as const
export type WorkspaceSetStatus = (typeof WORKSPACE_SET_STATUSES)[number]

export type WorkspaceEffectiveStatus =
  | 'running'
  | 'needs_input'
  | 'problem'
  | 'completed'
  | 'not_running'

/** One row of `GET /workspaces/statuses` — the FACTS the effective status
 *  derives from (the derivation itself lives in the web's one composable). */
export interface WorkspaceStatusReport {
  workspaceId: string
  /** The assistant-set state — null when nothing set. */
  setStatus: WorkspaceSetStatus | null
  /** The assistant's one-line why, when it gave one. */
  statusNote: string | null
  /** ISO-8601 — when the set state was written. */
  statusSetAt: string | null
  /** The workspace's LATEST turn envelope — null when it never ran. */
  latestTurn: {
    /** ISO-8601 */
    startedAt: string
    /** ISO-8601; null while running. */
    endedAt: string | null
    /** 'failed'/'orphaned' = the "stuck on an error" problem signal. */
    endedReason: 'ended' | 'orphaned' | 'failed' | null
  } | null
  /** Task rollup — the tree's `4/13` and the rail's "N of M tasks done". */
  tasksTotal: number
  tasksDone: number
}
