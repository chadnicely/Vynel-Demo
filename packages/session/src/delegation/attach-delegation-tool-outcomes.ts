// Enriches a thread's TOOL-CALL DTOs with the delegation each dispatch call
// enqueued — `attachDelegationTaskLabels`' sibling for the other end of the
// chain. A `send_message` / `send_task_*` card is the message that SENT the
// work; without this, the only door to its delegation is the processing
// banner, which lists in-flight jobs only — once the job settles, no
// affordance survives (Chad's 2026-07-27 smoke). The attached outcome keeps
// the history on the sending message permanently: status, where it went, and
// the trace key the activity monitor opens, live or settled.
//
// Lives HERE because it composes chat tool-call rows with orchestration jobs
// (the delegation-lift home; a leaf can't join its sibling). Loose-ref read at
// serve time — no schema change; the link is the jobId the dispatch route
// returned in the tool's own output.

import type { Database } from '@vynel/db'
import { findDelegationJobById, type DelegationJob } from '@vynel/orchestration'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'
import type { DelegationToolOutcomeResponse } from '@vynel/contracts/chat/chat-http'

const DELEGATION_TOOL_NAMES = new Set([
  'mcp__vynel__send_message',
  'mcp__vynel__send_task_to_workspace',
  'mcp__vynel__send_task_to_session',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseDispatchJson(text: string): { jobId: string; deliveredTo: string | null } | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || typeof parsed['jobId'] !== 'string') return null
    // The three dispatch routes name the destination DIFFERENTLY:
    // send_message → deliveredTo; send_task_to_workspace → workspaceName;
    // send_task_to_session → sessionName. Reading only one field made every
    // send_task chip fall back to a wrong "session" destination (increment-3
    // review catch — the fabricated test fixture defended the bad assumption).
    const destination = [parsed['deliveredTo'], parsed['workspaceName'], parsed['sessionName']].find(
      (value): value is string => typeof value === 'string',
    )
    return { jobId: parsed['jobId'], deliveredTo: destination ?? null }
  } catch {
    return null
  }
}

/** Every dispatch route answers `jobId` plus its own destination field; by the
 *  time that reaches the persisted tool row it may be wrapped as MCP text
 *  content, a bare content array, or a plain JSON string — unwrap all three,
 *  and answer null for anything else (an errored call's output is prose, not
 *  JSON). */
export function extractDispatchResult(
  toolOutput: unknown,
): { jobId: string; deliveredTo: string | null } | null {
  if (typeof toolOutput === 'string') return parseDispatchJson(toolOutput)
  // Arrays ARE records to `typeof` — unwrap the bare-array shape before
  // looking for the MCP `content` wrapper.
  const content = Array.isArray(toolOutput)
    ? toolOutput
    : isRecord(toolOutput)
      ? toolOutput['content']
      : null
  if (!Array.isArray(content)) return null
  for (const item of content) {
    if (isRecord(item) && typeof item['text'] === 'string') {
      const result = parseDispatchJson(item['text'])
      if (result !== null) return result
    }
  }
  return null
}

function hopTaskLabel(job: DelegationJob): string | null {
  if (job.jobKind === 'report-delivery') return null
  const label = deriveDelegationTaskLabel(job.taskText)
  return label === '' ? null : label
}

export function attachDelegationToolOutcomes<
  TCall extends { toolName: string; toolOutput?: unknown },
>(
  db: Database,
  toolCallsByMessageId: Record<string, TCall[]>,
): Record<string, (TCall & { delegation?: DelegationToolOutcomeResponse })[]> {
  return Object.fromEntries(
    Object.entries(toolCallsByMessageId).map(([messageId, calls]) => [
      messageId,
      calls.map((call) => {
        if (!DELEGATION_TOOL_NAMES.has(call.toolName)) return call
        const dispatch = extractDispatchResult(call.toolOutput)
        if (dispatch === null) return call
        const job = findDelegationJobById(db, dispatch.jobId)
        // A pruned/unknown job leaves the card unenriched rather than showing
        // a dead chip.
        if (job === null) return call
        // The DIRECT hop only — pipeline scoping (Chad, locked 2026-07-27): a
        // surface watches one level down; deeper hops live inside the opened
        // watch panel, never flattened into an ancestor thread.
        const outcome: DelegationToolOutcomeResponse = {
          jobId: job.id,
          partialSessionId: job.partialSessionId,
          status: job.status,
          deliveredTo: dispatch.deliveredTo,
          taskLabel: hopTaskLabel(job),
          reportedAt: job.reportedAt?.toISOString() ?? null,
          completedAt: job.completedAt?.toISOString() ?? null,
        }
        return { ...call, delegation: outcome }
      }),
    ]),
  )
}
