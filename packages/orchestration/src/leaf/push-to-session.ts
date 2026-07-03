// `pushToSession` — the by-reference "push" op (gold §5). Sends a follow-up task
// into an EXISTING leaf session by reference: resume the leaf's SDK session, run
// the prompt, drain, return the clean result. Composes
// `provider.startChatSession` with `resumeSessionId` (resume = push; the same
// primitive `startChatTurn` uses to resume a recorded session).
//
// PURE w.r.t. side-effects beyond the provider (no chat writes). The leaf keeps
// the safety backstop on resume (same `startChatSession` path). Tool grants from
// the original create persist on the resumed SDK session; re-applying per-agent
// grants on push is a later refinement (3a's proof delegation is create-based).

import type { AiAgentProvider } from '@vynel/providers'
import { drainLeafTurn, buildRoutedLeafApprovalDenier } from './drain-leaf-turn.js'
import type { SessionReference } from './create-leaf-session.js'

export type PushToSessionInput = {
  /** The leaf session to push into (from `createLeafSession`). */
  reference: SessionReference
  /** The leaf's cwd (the workspace folder). */
  workspacePath: string
  /** The follow-up task. */
  promptText: string
  /** Optional model override. */
  model?: string
}

export async function pushToSession(
  provider: AiAgentProvider,
  input: PushToSessionInput,
): Promise<string> {
  const drained = await drainLeafTurn(
    provider.startChatSession({
      workspacePath: input.workspacePath,
      resumeSessionId: input.reference,
      userMessageText: input.promptText,
      permissionMode: 'bypass-with-behavior-gate',
      allowedToolNames: [],
      deniedToolNames: [],
      ...(input.model !== undefined ? { model: input.model } : {}),
    }),
    // Fail-closed on a carded tool — a routed leaf has no user to ask (see drainLeafTurn).
    { onApprovalRequested: buildRoutedLeafApprovalDenier(provider) },
  )
  return drained.resultText
}
