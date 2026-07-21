// `resolveDelegationTrace` — the condensed, ordered, attributed trace of ONE delegation
// request (brain-tree Chapter 2, the trace-read). Given a request's correlation key
// (`partialSessionId`), it returns every message the request produced — the
// global→workspace task, the workspace reply, the bubbled-up global report — as
// lightweight entries, WITHOUT loading the heavy SDK sessions. Ch3's side panel renders
// it; Ch2 builds the correlation + this read.
//
// Cross-domain READ for a composed view: it anchors on orchestration's `delegation_jobs`
// row, then reads chat's messages to assemble the trace. It lives HERE (the session tier's
// delegation folder) rather than in `@vynel/orchestration` per that barrel's locked note — the
// delegation-engine leaf's only cross-dep stays `agents`; the session tier composes both
// domains. This is a read, not a cross-write — no outbox needed.
//
// FAITHFUL chain, NO dedup: the workspace reply and the global report carry the same body
// (the workspace root's answer surfaced in two transcripts); BOTH are returned, each with
// its own `sessionId`. Deduping would be lossy — on the push-skipped path (no live global
// root) the workspace reply is the ONLY copy of the answer, so dropping it deletes the
// answer. Ch3 collapses for display if it wants (the task row's `sessionId` marks the
// workspace transcript; a `workspace-manager` row on a different `sessionId` is the
// surfaced report) — the foundation stays faithful.

import type { Database } from '@vynel/db'
import {
  findDelegationJobByPartialSessionId,
  type DelegationJobStatus,
} from '@vynel/orchestration'
import {
  listChatMessagesByPartialSessionId,
  listChatToolCallsForMessage,
  findChatSessionById,
  type ChatMessageRole,
  type ChatMessageSourceKind,
  type ChatToolCall,
} from '@vynel/chat/repositories'
import * as primarySessionsRepository from '../repositories/index.js'
import { resolveSpawnedSessionDisplayName } from './resolve-spawned-session-name.js'

/** Which session a trace entry lives on. The drill-down target is `'workspace'`; the
 *  global-root session (`'global'`) holds the delegation acknowledgement + the surfaced
 *  report and is the /global view itself, so it is never drilled into. */
export type TraceEntryScope = 'global' | 'workspace'

export interface ResolveDelegationTraceInput {
  /** The owning user — the tenant gate (anchored on the job that minted the key). */
  userId: string
  /** The delegation request's correlation key. */
  partialSessionId: string
}

/** One message in the trace — a light row, not a heavy session. */
export interface DelegationTraceEntry {
  id: string
  role: ChatMessageRole
  /** Brain-tree source attribution ('global-root' | 'workspace-manager' | …); null on
   *  plain rows. */
  sourceKind: ChatMessageSourceKind | null
  /** The workspace / agent name for an attributed report; null otherwise. */
  sourceLabel: string | null
  body: string
  /** Which transcript this entry lives on (the workspace root's vs the global root's
   *  SDK session) — lets a consumer tell the workspace reply from the surfaced report. */
  sessionId: string
  /** 'workspace' when the session is a workspace-root one (the drill-down target),
   *  'global' on the global-root session. Derived from the session's `workspaceId` —
   *  NOT inferred from `sourceKind` (the Ch3.5 acknowledgement is `global-root` yet lives
   *  on the global session). */
  scope: TraceEntryScope
  /** The assistant entry's tool calls (live rows — the shared pipeline persists them
   *  as they run, so a polling Watch panel shows tools mid-turn). Empty on user rows. */
  toolCalls: ChatToolCall[]
  createdAt: Date
}

/** The SPAWNED session a session-target delegation ran in — the watch-pipeline
 *  drill's identity (Chad's 2026-07-21 scoping rules): from a trace node the
 *  panel pushes a `{kind:'session'}` node over this session. `sessionId` is the
 *  target's CURRENT SDK segment (resolved fresh — the chain may have swapped
 *  since the rows persisted), which is exactly what the session watch channel
 *  and the owner-gated session read key on. */
export type SpawnedTargetSession = {
  sessionId: string
  name: string
}

export interface DelegationTrace {
  partialSessionId: string
  /** The delegation's lifecycle status — lets a live consumer poll while it's still working
   *  (`pending`/`claimed`) and settle when terminal (`completed`/`failed`). Null when the key
   *  is unknown / not owned (the empty trace). */
  status: DelegationJobStatus | null
  /** Non-null ONLY for a session-target job (the anchor row carries
   *  `targetPrimarySessionId`) whose spawned primary still resolves — workspace
   *  targets and pruned/unlinked targets read null (no drill offered). */
  spawnedTargetSession: SpawnedTargetSession | null
  entries: DelegationTraceEntry[]
}

/** Resolve the condensed trace for one delegation request. An unknown key OR a key owned
 *  by another user yields an EMPTY trace — identical response for both (no enumeration
 *  leak). */
export function resolveDelegationTrace(
  db: Database,
  input: ResolveDelegationTraceInput,
): DelegationTrace {
  // Tenant gate via the job that minted the key (the ownership anchor). Empty trace on
  // miss OR cross-user — no enumeration leak.
  const job = findDelegationJobByPartialSessionId(db, input.partialSessionId)
  if (job === null || job.userId !== input.userId) {
    return {
      partialSessionId: input.partialSessionId,
      status: null,
      spawnedTargetSession: null,
      entries: [],
    }
  }

  // The pipeline-drill identity (session-target jobs only): the spawned primary
  // resolved FRESH off the anchor row, so the drill lands on the chain's CURRENT
  // segment even after a mid-run swap. A deleted/unlinked/foreign primary reads
  // null — the trace still renders, just without a drill.
  const spawnedTargetSession = resolveSpawnedTargetSession(db, job.targetPrimarySessionId, job.userId)

  // Each entry's SCOPE, by the session's `workspaceId` (cached per session — a trace has a
  // handful of entries across 1-2 sessions). A workspace-root session carries its
  // workspaceId; the global-root session's is null. This is the robust "which session is the
  // workspace one" signal — do NOT infer from sourceKind (the Ch3.5 acknowledgement is
  // 'global-root' but lives on the global session, which would mis-target the drill-down).
  const scopeBySession = new Map<string, TraceEntryScope>()
  const scopeOf = (sessionId: string): TraceEntryScope => {
    const cached = scopeBySession.get(sessionId)
    if (cached) return cached
    const session = findChatSessionById(db, sessionId)
    const scope: TraceEntryScope = session?.workspaceId != null ? 'workspace' : 'global'
    scopeBySession.set(sessionId, scope)
    return scope
  }

  // The unscoped message read is sound: `partialSessionId` is a per-delegation UUID stamped
  // ONLY by this flow's taggers, so the anchoring job's `userId` owns every tagged row — no
  // separate per-message userId filter is needed (the anchor gates).
  const entries = listChatMessagesByPartialSessionId(db, input.partialSessionId).map(
    (message): DelegationTraceEntry => ({
      id: message.id,
      role: message.role,
      sourceKind: message.sourceKind,
      sourceLabel: message.sourceLabel,
      body: message.body,
      sessionId: message.sessionId,
      scope: scopeOf(message.sessionId),
      toolCalls: message.role === 'assistant' ? listChatToolCallsForMessage(db, message.id) : [],
      createdAt: message.createdAt,
    }),
  )

  return { partialSessionId: input.partialSessionId, status: job.status, spawnedTargetSession, entries }
}

function resolveSpawnedTargetSession(
  db: Database,
  targetPrimarySessionId: string | null,
  userId: string,
): SpawnedTargetSession | null {
  if (targetPrimarySessionId === null) return null
  const primary = primarySessionsRepository.findPrimarySessionById(db, targetPrimarySessionId)
  if (primary === null || primary.userId !== userId || primary.currentSdkSessionId === null) {
    return null
  }
  return {
    sessionId: primary.currentSdkSessionId,
    // One naming home with the tick's attribution + the in-flight chip — the
    // drill can never call the session something its rows don't.
    name: resolveSpawnedSessionDisplayName(db, primary),
  }
}
