// `delegateToWorkspaceRoot` — the apps/local-api composition for routing a task INTO a
// workspace's CONTINUING PRIMARY conversation (brain-tree Phase 1, the thin path).
// Sibling of `delegateToLeafSession`, but instead of spawning a fresh throwaway
// agent it resumes the workspace's OWN brain (its primary session, with its context),
// so "hey jarvis, in Acme, summarize the notes" reaches Acme's actual conversation.
//
// It is the layer that injects the provider AND ties the pure
// `@vynel/orchestration` run-op to the chat + session-continuity recording —
// the `delegate-to-leaf-session` layering precedent (orchestration stays pure; it
// never writes chat's tables).
//
// Flow: resolve the workspace primary + the session to resume → run the task on it
// (resume, or fresh on the first delegation), drained read-safe → record + link the
// segment if it ran on a NEW sdk session (fresh OR a compaction swap — the P0.1
// id-based gate) → emit the global→workspace-root tree edge for the monitor →
// persist the task + result attributed → return the clean result the global root
// absorbs.
//
// v1 is READ-SAFE: the routed turn fails closed on a carded tool (no user watching).
// Mutating + approval-surfaced-up is a later slice (brain-tree fork 3).

import type { Database } from '@vynel/db'
import type { AiAgentProvider, AiAgentProviderId } from '@vynel/providers'
import {
  runRootDelegationTurn,
  recordDelegation,
  type DelegationPermissionMode,
} from '@vynel/orchestration'
import { recordSwapSegmentSession, recordDelegatedRootMessages } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { linkPrimarySessionToSdkSession } from '@vynel/session/continuity'
import { resolvePrimaryConversationTarget } from '@vynel/session/runtime'

export type DelegateToWorkspaceRootInput = {
  /** The delegating (parent) session — the global root's current SDK session id. */
  parentSessionId: string
  userId: string
  /** The workspace whose ROOT brain handles the task. */
  workspaceId: string
  /** The workspace folder on disk — the root's cwd. */
  workspacePath: string
  /** The workspace name — the bubbled report's `sourceLabel` base. */
  workspaceName: string
  /** The workspace manager's persona name (brain-tree Ch5) — composes "Mark · vynel".
   *  Absent → just the workspace name. */
  managerName?: string
  /** The task the global root delegates. */
  taskText: string
  /** The provider id stamped on the recorded segment. */
  providerId: AiAgentProviderId
  /** Optional model override for the delegated turn. */
  model?: string
  /** The permission mode the routed turn runs under (surface-up step 1) — from the
   *  job row. Omit for the pre-mode default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
  /** The delegation request's correlation key (brain-tree Chapter 2) — stamped on the
   *  workspace-side task + reply so the chain is queryable as one trace. */
  partialSessionId?: string
}

export type DelegateToWorkspaceRootResult = {
  /** The workspace root's session reference (its SDK session id). */
  reference: string
  /** The workspace root's clean answer — what the global root absorbs. */
  resultText: string
}

export async function delegateToWorkspaceRoot(
  db: Database,
  provider: AiAgentProvider,
  input: DelegateToWorkspaceRootInput,
): Promise<DelegateToWorkspaceRootResult> {
  // 1. Resolve the workspace's continuing primary + the SDK session to resume.
  const target = await resolvePrimaryConversationTarget(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  })

  // 2. Run the task ON the workspace root — resume its brain, or fresh on first use.
  const drained = await runRootDelegationTurn(provider, {
    workspacePath: input.workspacePath,
    ...(target.resumeSdkSessionId !== null ? { resumeSessionId: target.resumeSdkSessionId } : {}),
    taskText: input.taskText,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
  })

  // 3. Record + link the segment if the turn ran on a NEW sdk session (fresh root OR
  //    a compaction swap — the P0.1 id-based gate). An already-recorded session
  //    (resumed) is a no-op here.
  if (findChatSessionById(db, drained.sessionId) === null) {
    recordSwapSegmentSession(db, {
      sessionId: drained.sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
    })
    linkPrimarySessionToSdkSession(db, {
      primarySessionId: target.primarySessionId,
      userId: input.userId,
      sdkSessionId: drained.sessionId,
    })
  }

  // 4. The parent→child tree edge (global root → workspace root) for the monitor.
  recordDelegation(db, {
    parentSessionId: input.parentSessionId,
    childSessionId: drained.sessionId,
    role: 'workspace-root',
    userId: input.userId,
  })

  // 5. Persist the routed exchange to the workspace transcript, attributed + trace-keyed.
  //    Conditional-spread the correlation key (exactOptionalPropertyTypes): absent → omit.
  recordDelegatedRootMessages(db, {
    sessionId: drained.sessionId,
    taskText: input.taskText,
    resultText: drained.resultText,
    workspaceName: input.workspaceName,
    ...(input.managerName !== undefined ? { managerName: input.managerName } : {}),
    ...(input.partialSessionId !== undefined ? { partialSessionId: input.partialSessionId } : {}),
  })

  return { reference: drained.sessionId, resultText: drained.resultText }
}
