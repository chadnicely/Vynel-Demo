// `delegateToLeafSession` — the session-tier composition for by-reference delegation
// (Slice 3a). It is the ONLY layer that injects BOTH the provider AND the
// chat-domain recording, tying the pure `@vynel/orchestration` ops to the
// chat `chat_sessions` row + the `session.delegated` edge — exactly the
// bridge-after-turn layering precedent (orchestration stays pure; it never
// writes chat's tables).
//
// Flow: run the leaf in its own SDK session (the safety backstop is inherited via
// `startChatSession`) → record the leaf as a hidden, browsable chat segment →
// emit the parent→child `session.delegated` edge for the monitor. The root
// absorbs only the clean result.
//
// CONSUMERS: the chat-mentions 'agent-run' queue branch (`run-agent-run-job.ts`)
// — a `@agent` mention becomes one background leaf run of exactly this shape.
// The routing path does NOT bind this — `send_task_to_workspace` routes into the
// workspace's own ROOT brain (`delegate-to-workspace-root.ts`, the thin path);
// the locked 3-level hierarchy (global → workspace-root → agent) also builds on
// this when it lands.

import type { Database } from '@vynel/db'
import type { AiAgentProvider, AiAgentProviderId } from '@vynel/providers'
import { createLeafSession, recordDelegation } from '@vynel/orchestration'
import { recordLeafSession } from '@vynel/chat'

export type DelegateToLeafSessionInput = {
  /** The delegating (parent) session — the root or a manager. */
  parentSessionId: string
  userId: string
  /** Null for a GLOBAL-grounded leaf (chat-mentions): user-scope agent, global cwd. */
  workspaceId: string | null
  /** The leaf's cwd (the workspace folder on disk, or the global root's dir). */
  workspacePath: string
  /** Which agent ("hand") to delegate to. */
  agentSlug: string
  /** The task the root delegates. */
  taskText: string
  /** The provider id stamped on the recorded leaf segment. */
  providerId: AiAgentProviderId
  /** Optional model override for the leaf turn. */
  model?: string
}

export type DelegateToLeafSessionResult = {
  /** The leaf's session reference (its SDK session id). */
  reference: string
  /** The leaf's clean answer text. */
  resultText: string
}

export async function delegateToLeafSession(
  db: Database,
  provider: AiAgentProvider,
  input: DelegateToLeafSessionInput,
): Promise<DelegateToLeafSessionResult> {
  // 1. Run the leaf by reference — its own SDK session; safety backstop inherited.
  const leaf = await createLeafSession(db, provider, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    agentSlug: input.agentSlug,
    taskText: input.taskText,
    ...(input.model !== undefined ? { model: input.model } : {}),
  })

  // 2. Record the leaf as a hidden, browsable chat segment (gold §7).
  recordLeafSession(db, {
    sessionId: leaf.reference,
    userId: input.userId,
    workspaceId: input.workspaceId,
    providerId: input.providerId,
    agentSlug: leaf.agentSlug,
  })

  // 3. Record the parent→child tree edge (the monitor / Slice 5a consumes it).
  recordDelegation(db, {
    parentSessionId: input.parentSessionId,
    childSessionId: leaf.reference,
    role: leaf.agentSlug,
    userId: input.userId,
  })

  return { reference: leaf.reference, resultText: leaf.resultText }
}
