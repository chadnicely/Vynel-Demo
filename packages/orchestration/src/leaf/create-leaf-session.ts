// `createLeafSession` — the by-reference "create" op (gold §5). Resolves a Vynel
// agent by slug, maps its row to a standalone leaf `StartChatSessionInput` (Mode
// B), starts a FRESH SDK session (no `resumeSessionId`) running the delegated
// task, and drains the turn to capture the new session id (the reference) + the
// clean result. The leaf runs in ITS OWN context; the caller absorbs only the
// result ("roots are managers, not doers").
//
// PURE w.r.t. side-effects beyond the provider: it does NOT write `chat_sessions`
// or emit the `session.delegated` edge — that recording is the apps/api
// composition's job (the `bridge-root-session-after-turn` layering precedent), so
// orchestration never writes another domain's tables. `db` is taken only to
// RESOLVE the agent row (read).
//
// The leaf inherits the safety backstop automatically: it starts through
// `provider.startChatSession` → `buildClaudeSdkOptions` → the `PreToolUse` hook +
// `canUseTool`, so every irreversible leaf tool still cards. `startChatSession`
// is the SOLE leaf-spawn path — never bypass it.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import type { AiAgentProvider } from '@vynel/providers'
import { findAgentBySlug } from '@vynel/agents'
import { mapAgentToLeafInput } from './map-agent-to-leaf-input.js'
import { drainLeafTurn, buildRoutedLeafApprovalDenier } from './drain-leaf-turn.js'

/** A by-reference handle to a session = its SDK session id (D15). */
export type SessionReference = string

export type CreateLeafSessionInput = {
  userId: string
  /** The workspace the leaf runs in + the scope the agent slug resolves at. */
  workspaceId: string
  /** The leaf's cwd (the workspace folder on disk). */
  workspacePath: string
  /** Which agent ("hand") to delegate to. */
  agentSlug: string
  /** The task the root delegates — the leaf's first message. */
  taskText: string
  /** Optional model override for the leaf turn. */
  model?: string
}

export type CreateLeafSessionResult = {
  /** The leaf's SDK session id — pass to `pushToSession` / `lookUpSession`. */
  reference: SessionReference
  /** The leaf's clean answer text (what the root absorbs). */
  resultText: string
  /** The delegated agent's slug — the `session.delegated` edge role. */
  agentSlug: string
}

export async function createLeafSession(
  db: Database,
  provider: AiAgentProvider,
  input: CreateLeafSessionInput,
): Promise<CreateLeafSessionResult> {
  // Resolve the "hand" preferring the target workspace's scope, falling back to
  // the user scope (the @mention resolution — a user-scoped agent is available in
  // every workspace, the same union `listAgentsForWorkspace` exposes). The leaf
  // still runs IN the target workspace (`workspacePath`) regardless of where the
  // agent row lives. `workspaceId` here is the agent-RESOLUTION scope.
  const agent =
    (await findAgentBySlug(db, {
      userId: input.userId,
      workspaceId: input.workspaceId,
      slug: input.agentSlug,
    })) ??
    (await findAgentBySlug(db, {
      userId: input.userId,
      workspaceId: null,
      slug: input.agentSlug,
    }))
  if (!agent) throw new NotFoundError('agent', input.agentSlug)

  const leafInput = mapAgentToLeafInput(agent, {
    workspacePath: input.workspacePath,
    taskText: input.taskText,
    ...(input.model !== undefined ? { model: input.model } : {}),
  })

  // Fail-closed on a carded tool — a routed leaf has no user to ask (see drainLeafTurn).
  const drained = await drainLeafTurn(provider.startChatSession(leafInput), {
    onApprovalRequested: buildRoutedLeafApprovalDenier(provider),
  })
  return {
    reference: drained.sessionId,
    resultText: drained.resultText,
    agentSlug: input.agentSlug,
  }
}
