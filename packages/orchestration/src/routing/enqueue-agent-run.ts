// `enqueueAgentRun` — inserts a PENDING `delegation_jobs` row of kind
// 'agent-run' (chat-mentions): a `@agent` mention in a chat turn becomes ONE
// deterministic background leaf run of that agent carrying the user's message.
// Same durable FIFO queue, same claim machinery — the tick branches on
// `jobKind` and runs the agent leaf (`delegateToLeafSession`) instead of a
// routed conversation turn, then delivers the leaf's clean result back to the
// ORIGINATING chat as a report (`requesterWorkspaceId` null = the global root).
//
// ROW SHAPE (column reuse, the report-delivery precedent): `agentSlug` is the
// agent to run — resolved FRESH at claim time (workspace scope preferred, then
// user scope); `workspaceId` is the GROUNDING (the originating chat's
// workspace — the slug-resolution scope; null = global); `workspacePath` the
// leaf's run cwd; `workspaceName` the agent's DISPLAY NAME at enqueue (the
// report's source label, refreshed at claim when the row still resolves).
// `targetPrimarySessionId` is never set — a leaf runs fresh, it resumes
// nothing. NO `permissionMode`/`thinkingEffort`: a leaf always runs under
// `bypass-with-behavior-gate` with carded tools fail-closed DENIED
// (`mapAgentToLeafInput` — the non-negotiable leaf safety invariant).

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { resolveThreadId } from './resolve-thread-id.js'
import { insertDelegationJob } from '../repositories/index.js'

export interface EnqueueAgentRunInput {
  /** The chain this hop continues — one task and everything it caused. Omit to
   *  START a chain (the hop becomes its own thread). See `resolveThreadId`. */
  threadId?: string
  userId: string
  /** The originating turn's SDK session id — a LOOSE text ref (provenance). */
  parentSessionId: string
  /** The agent to run — re-resolved at claim time by the tick. */
  agentSlug: string
  /** The agent's display name at enqueue — the report label's fallback. */
  agentName: string
  /** The user's message — the leaf's first (and only) inbound. */
  taskText: string
  /** The GROUNDING: the originating chat's workspace (slug-resolution scope);
   *  null for the global root. */
  workspaceId: string | null
  /** The leaf's run cwd — the workspace folder, or the global root's hidden dir. */
  runCwdPath: string
  /** Where the result-report lands: the originating chat's workspace primary.
   *  Omit = the global root chat. */
  requesterWorkspaceId?: string
  /** The originating turn's model pick for the leaf. Omit = the agent's own. */
  model?: string
}

/** Enqueue one deterministic background agent run and return the job id. */
export function enqueueAgentRun(
  db: Database,
  input: EnqueueAgentRunInput,
  /** Injectable clock (the sibling enqueue ops' contract). */
  deps: { now?: () => Date } = {},
): string {
  if (input.agentSlug.trim() === '') {
    throw new Error('enqueueAgentRun: agentSlug must be a non-empty slug')
  }
  if (input.runCwdPath.trim() === '') {
    throw new Error('enqueueAgentRun: runCwdPath must be a non-empty path')
  }
  const now = (deps.now ?? (() => new Date()))()
  const id = randomUUID()
  // The correlation key (same contract as every enqueue): minted once per
  // request so the leaf run and its result-report share one watchable trace.
  const partialSessionId = randomUUID()
  insertDelegationJob(db, {
    id,
    userId: input.userId,
    parentSessionId: input.parentSessionId,
    workspaceId: input.workspaceId,
    workspacePath: input.runCwdPath,
    workspaceName: input.agentName,
    targetPrimarySessionId: null,
    taskText: input.taskText,
    partialSessionId,
    threadId: resolveThreadId({
      ...(input.threadId !== undefined ? { inheritedThreadId: input.threadId } : {}),
      partialSessionId,
    }),
    status: 'pending',
    claimedAt: null,
    completedAt: null,
    resultText: null,
    errorMessage: null,
    surfacedToRootAt: null,
    originChannelId: null,
    originExternalSenderId: null,
    originExternalChatContextId: null,
    permissionMode: null,
    model: input.model ?? null,
    thinkingEffort: null,
    jobKind: 'agent-run',
    agentSlug: input.agentSlug,
    requesterWorkspaceId: input.requesterWorkspaceId ?? null,
    createdAt: now,
  })
  return id
}
