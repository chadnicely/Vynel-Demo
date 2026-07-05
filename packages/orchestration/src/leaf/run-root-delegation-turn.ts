// `runRootDelegationTurn` — the by-reference "run a turn on the WORKSPACE ROOT" op
// (brain-tree Phase 1). When the global root routes a task to a workspace, the task
// runs on that workspace's CONTINUING root conversation (its own brain, with its
// context) — NOT a fresh throwaway agent (the Slice-3a leaf path). The op resumes
// the workspace root's SDK session (or starts fresh on the first delegation), runs
// the task, drains the turn, and returns the session id (the segment the api
// composition records) + the clean result the global root absorbs.
//
// Sibling of `pushToSession`: same resume-and-drain primitive, but it ALSO allows a
// fresh start (a workspace root that has never run gets no `resumeSessionId`) and
// returns the session id (pushToSession returns only the text — a leaf's id is
// already known). PURE w.r.t. side-effects beyond the provider (no chat writes) —
// the api composition (`delegateToWorkspaceRoot`) owns recording + persistence.
//
// READ-SAFE: like every routed sub-session, there is no user watching the stream, so
// a carded (irreversible) tool fails closed (auto-deny via the routed-leaf denier).
// Interactive approval surfaced UP to the user is a deferred slice (brain-tree fork 3).

import type { AiAgentProvider } from '@vynel/providers'
import type { DelegationPermissionMode } from '../orchestration-types.js'
import {
  drainLeafTurn,
  buildRoutedLeafApprovalDenier,
  ROUTED_LEAF_MAX_CARDED_DENIALS,
} from './drain-leaf-turn.js'

export type RunRootDelegationTurnInput = {
  /** The workspace folder on disk — the workspace root's cwd. */
  workspacePath: string
  /** The workspace root's current SDK session to resume; omit on the FIRST
   *  delegation (the root has no session yet — start fresh). */
  resumeSessionId?: string
  /** The task the global root delegates — the turn's message. */
  taskText: string
  /** Optional model override for the delegated turn. */
  model?: string
  /** The permission mode the routed turn runs under — the delegating turn's mode
   *  (surface-up step 1). Omit for the pre-mode default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
}

export type RunRootDelegationTurnResult = {
  /** The SDK session the turn ran on (resumed or fresh) — the recorded segment id. */
  sessionId: string
  /** The workspace root's answer — the clean result the global root absorbs. */
  resultText: string
}

export async function runRootDelegationTurn(
  provider: AiAgentProvider,
  input: RunRootDelegationTurnInput,
): Promise<RunRootDelegationTurnResult> {
  return drainLeafTurn(
    provider.startChatSession({
      workspacePath: input.workspacePath,
      ...(input.resumeSessionId !== undefined ? { resumeSessionId: input.resumeSessionId } : {}),
      userMessageText: input.taskText,
      permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
      // Empty grants: a resumed root keeps the workspace's existing tool grants; a
      // fresh root gets the SDK defaults. Either way the behavior gate fires and the
      // routed turn fails closed on a carded tool (read-safe).
      allowedToolNames: [],
      deniedToolNames: [],
      ...(input.model !== undefined ? { model: input.model } : {}),
    }),
    {
      onApprovalRequested: buildRoutedLeafApprovalDenier(provider),
      // Fail fast on a write task: if the leaf keeps reaching for irreversible tools past the
      // deny + steer, interrupt it instead of burning the route timeout (owner's "stuck on
      // permission" fix). A compliant read-safe report never trips it.
      maxCardedDenials: ROUTED_LEAF_MAX_CARDED_DENIALS,
      interruptSession: (sessionId) => provider.interruptChatSession(sessionId),
    },
  )
}
