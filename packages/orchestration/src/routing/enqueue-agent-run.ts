// `enqueueAgentRun` — inserts a PENDING `delegation_jobs` row of kind
// 'agent-run' (chat-mentions → persona-sessions): a `@agent` mention in a chat
// turn becomes ONE deterministic background turn on that agent's COLLEAGUE
// session (`delegateToAgentSession` — the continuing scope-'agent' primary the
// mention resumes; persona + memory accumulate). Same durable FIFO queue, same
// claim machinery — the tick branches on `jobKind`. The colleague speaks its
// own ack/report via `send_message`; nothing is harvested.
//
// ROW SHAPE (column reuse, the report-delivery precedent): `agentSlug` is the
// agent to run — resolved FRESH at claim time (workspace scope preferred, then
// user scope); `workspaceId` is the GROUNDING (the originating chat's
// workspace — the slug-resolution scope AND the colleague's identity key half;
// null = global); `workspacePath` the run cwd; `workspaceName` the agent's
// DISPLAY NAME at enqueue. `targetPrimarySessionId` is the COLLEAGUE primary
// (stamped at enqueue so the claim's same-target exclusion serializes runs
// FIFO-per-colleague; a legacy NULL resolves get-or-create at claim time).
// `permissionMode` threads the originating turn's mode (the persona-delegation
// precedent); null = the routed default `bypass-with-behavior-gate`.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { resolveThreadId } from './resolve-thread-id.js'
import { insertDelegationJob } from '../repositories/index.js'
import type { DelegationPermissionMode } from '../orchestration-types.js'

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
  /** The user's message — the colleague's inbound this turn. */
  taskText: string
  /** The GROUNDING: the originating chat's workspace (slug-resolution scope +
   *  the colleague's identity key half); null for the global root. */
  workspaceId: string | null
  /** The run cwd — the workspace folder, or the global root's hidden dir. */
  runCwdPath: string
  /** The colleague primary this run resumes (persona-sessions) — stamped so the
   *  claim serializes same-colleague runs. Omit only for legacy shapes; the
   *  tick then resolves get-or-create at claim time. */
  targetPrimarySessionId?: string
  /** Where the result-report lands: the originating chat's workspace primary.
   *  Omit = the global root chat. */
  requesterWorkspaceId?: string
  /** The originating turn's permission mode for the colleague turn. Omit = the
   *  routed default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
  /** The originating turn's model pick. Omit = the agent's own. */
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
    targetPrimarySessionId: input.targetPrimarySessionId ?? null,
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
    permissionMode: input.permissionMode ?? null,
    model: input.model ?? null,
    thinkingEffort: null,
    jobKind: 'agent-run',
    agentSlug: input.agentSlug,
    requesterWorkspaceId: input.requesterWorkspaceId ?? null,
    createdAt: now,
  })
  return id
}
