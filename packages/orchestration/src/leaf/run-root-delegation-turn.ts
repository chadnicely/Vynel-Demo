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
// APPROVALS (surface-up, brain-tree fork 3 — BUILT): the composing tier injects
// `onApprovalRequested` (record-and-park — the card reaches the web notifier +
// the origin channel; the provider stays parked until the user decides) and
// `onApprovalResolved` (resumes the suspended wait budget). Without the
// injection the turn falls back to the fail-closed auto-deny (read-safe).

import type { AiAgentProvider } from '@vynel/providers'
import type { DelegationPermissionMode } from '../orchestration-types.js'
import {
  drainLeafTurn,
  buildRoutedLeafApprovalDenier,
  ROUTED_LEAF_MAX_CARDED_DENIALS,
  type DrainLeafTurnOptions,
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
  /** Surface-up: record-and-park a carded tool so the user decides from the notifier /
   *  origin channel. Omit for the fail-closed auto-deny fallback. */
  onApprovalRequested?: DrainLeafTurnOptions['onApprovalRequested']
  /** Surface-up: observes each decision (resumes the suspended wait budget). */
  onApprovalResolved?: DrainLeafTurnOptions['onApprovalResolved']
}

export type RunRootDelegationTurnResult = {
  /** The SDK session the turn ran on (resumed or fresh) — the recorded segment id. */
  sessionId: string
  /** The workspace root's answer — the clean result the global root absorbs. */
  resultText: string
}

// How a routed (background) turn should behave — appended to the system prompt, NOT the
// task text (the task is persisted verbatim to the transcript). Steers the model to
// read-only tools for read tasks (the owner-reported "reached for Bash on 'list files'"
// papercut) and sets expectations for the surface-up approval pause.
export const ROUTED_TASK_INSTRUCTIONS =
  'This task was routed from the user’s assistant and runs in the background. Prefer ' +
  'read-only tools (Read, Glob, Grep, LS) for read/analysis tasks. An irreversible action ' +
  '(write, edit, delete, shell command) PAUSES until the user approves it from their app or ' +
  'chat — use one only when the task genuinely needs it, and if it is denied or times ' +
  'out, report your findings as text instead of retrying.'

export async function runRootDelegationTurn(
  provider: AiAgentProvider,
  input: RunRootDelegationTurnInput,
): Promise<RunRootDelegationTurnResult> {
  return drainLeafTurn(
    provider.startChatSession({
      workspacePath: input.workspacePath,
      ...(input.resumeSessionId !== undefined ? { resumeSessionId: input.resumeSessionId } : {}),
      userMessageText: input.taskText,
      systemPromptAppend: ROUTED_TASK_INSTRUCTIONS,
      permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
      // Empty grants: a resumed root keeps the workspace's existing tool grants; a
      // fresh root gets the SDK defaults. Either way the behavior gate fires and the
      // routed turn fails closed on a carded tool (read-safe).
      allowedToolNames: [],
      deniedToolNames: [],
      ...(input.model !== undefined ? { model: input.model } : {}),
    }),
    {
      onApprovalRequested: input.onApprovalRequested ?? buildRoutedLeafApprovalDenier(provider),
      ...(input.onApprovalResolved !== undefined
        ? { onApprovalResolved: input.onApprovalResolved }
        : {}),
      // Fail fast on repeated DENIALS: if the leaf keeps proposing irreversible actions past
      // the denials (auto or human), interrupt it instead of burning the route timeout
      // (owner's "stuck on permission" fix). A compliant report never trips it.
      maxCardedDenials: ROUTED_LEAF_MAX_CARDED_DENIALS,
      interruptSession: (sessionId) => provider.interruptChatSession(sessionId),
    },
  )
}
