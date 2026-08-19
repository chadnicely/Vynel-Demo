// `prepareComposerMentionTurn` — the ONE home for what a chat turn does with
// the composer tokens in its message (chat-mentions). All three turn streams
// (global root, workspace chat, spawned-session thread) call this once before
// streaming:
//
//   @agent / @Persona → deterministic BACKGROUND dispatches (never
//     model-chosen): an agent mention enqueues one 'agent-run' job on that
//     agent's COLLEAGUE session (persona-sessions — get-or-created here so the
//     claim serializes same-colleague runs); a persona mention enqueues a
//     workspace delegation to that persona's workspace. Both carry the
//     ORIGINATING chat as `requesterWorkspaceId` (null = the global root), so
//     the report lands where the user typed. The enqueue waits for the turn's
//     session identity (`onSessionResolved`) — the job's provenance edge is
//     the very turn that carried the mention.
//
//   #workspace → the per-turn read-only STUDY descriptor over exactly the
//     referenced workspaces (`@vynel/workspaces/mcp`, dynamically imported —
//     the SDK-builder half stays out of module load on token-free turns).
//
// SERVER RE-PARSE IS THE SOURCE OF TRUTH: this reads `userMessageText` and
// resolves against real rows (`resolveMentions`); no client-resolved id is
// ever trusted for routing (the dispatch-message posture). Failures here are
// LOGGED AND SWALLOWED by design — mention machinery must never break the
// user's turn (the one deliberate never-throw seam; each enqueue is
// individually guarded too).

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  enqueueAgentRun,
  enqueueWorkspaceDelegation,
  findDelegationJobById,
  resolveMentions,
  type DelegationPermissionMode,
  type ResolvedComposerMentions,
} from '@vynel/orchestration'
import { stampNewestUserMessageTraceKey } from '@vynel/chat/repositories'
import { getOrCreateContinuingSession } from '@vynel/session/continuity'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import type { McpFeatureDescriptor } from '@vynel/mcp-contract'

export interface ComposerMentionTurnInput {
  userId: string
  userMessageText: string
  /** The originating chat's workspace — null for the global root (and for a
   *  global-grounded spawned thread). Doubles as the agent leaves' grounding
   *  and the report destination. */
  originWorkspaceId: string | null
  /** The originating chat's run cwd — the agent leaves run here (the
   *  workspace folder, or the global root's hidden dir). */
  originWorkspacePath: string
  /** The turn's picks, threaded onto persona delegations AND colleague runs
   *  (persona-sessions — a colleague turn is a routed turn like any other).
   *  All three ride BOTH branches: an @agent run that dropped the effort ran at
   *  the adaptive default while the mention that spawned it was on max. */
  permissionMode?: DelegationPermissionMode
  model?: string
  thinkingEffort?: ThinkingEffortLevel
}

export interface ComposerMentionTurnPlan {
  /** The per-turn study descriptor — null when the message carried no
   *  resolvable # refs. Compose it into the turn's descriptor list. */
  studyDescriptor: McpFeatureDescriptor | null
  /** The dispatch note for the CURRENT turn's system prompt ('' when no @
   *  dispatches) — tells the model the work is already running so it neither
   *  duplicates nor re-delegates it. */
  systemPromptAppend: string
  /** Enqueues the @ dispatches ONCE, keyed to the turn's resolved session id
   *  (call it from the stream's session-created / user-message-persisted tap).
   *  Idempotent; never throws. */
  onSessionResolved: (sdkSessionId: string) => void
}

function composeDispatchNote(
  agents: ResolvedComposerMentions['agents'],
  personas: ResolvedComposerMentions['personas'],
): string {
  if (agents.length === 0 && personas.length === 0) return ''
  const dispatched = [
    ...agents.map((agent) => `agent "${agent.name}" (@${agent.slug})`),
    ...personas.map(
      (persona) => `${persona.managerName} (workspace "${persona.workspaceName}")`,
    ),
  ].join('; ')
  return (
    `Background mention dispatch (done by the system, not by you): ${dispatched} — each ` +
    'was handed this same message as a background task and will speak its own ' +
    'acknowledgment and report into this chat with send_message as it works. Do NOT ' +
    'duplicate, re-run, or re-delegate that work; handle the rest of the message ' +
    'yourself and tell the user the mentioned runs are underway.'
  )
}

/** Parse + resolve the turn's composer tokens and plan their effects.
 *  Returns null when the message carries nothing actionable (the fast path). */
export async function prepareComposerMentionTurn(
  db: Database,
  input: ComposerMentionTurnInput,
  deps: { logger: Logger },
): Promise<ComposerMentionTurnPlan | null> {
  let resolved: ResolvedComposerMentions
  try {
    resolved = await resolveMentions(db, {
      text: input.userMessageText,
      userId: input.userId,
      workspaceId: input.originWorkspaceId,
    })
  } catch (err) {
    deps.logger.error({ err }, 'composer-mention resolution failed — turn proceeds without it')
    return null
  }

  // Self-references dissolve: a @persona of THIS workspace is already the one
  // being addressed, and a #ref to THIS workspace grants nothing the turn's
  // own cwd doesn't already have.
  const personas = resolved.personas.filter(
    (persona) => persona.workspaceId !== input.originWorkspaceId,
  )
  const workspaceRefs = resolved.workspaceRefs.filter(
    (ref) => ref.workspaceId !== input.originWorkspaceId,
  )
  const agents = resolved.agents
  if (agents.length === 0 && personas.length === 0 && workspaceRefs.length === 0) return null

  let studyDescriptor: McpFeatureDescriptor | null = null
  if (workspaceRefs.length > 0) {
    const { buildWorkspaceStudyDescriptor } = await import('@vynel/workspaces/mcp')
    studyDescriptor = buildWorkspaceStudyDescriptor({
      workspaces: workspaceRefs.map((ref) => ({
        id: ref.workspaceId,
        name: ref.workspaceName,
        path: ref.workspacePath,
        managerName: ref.managerName,
      })),
    })
  }

  // Resolve each mentioned agent's COLLEAGUE identity now (persona-sessions):
  // get-or-create is sync-DB and idempotent, and the id must exist BEFORE the
  // enqueue so the claim serializes same-colleague runs. Guarded per agent —
  // a failed resolve falls back to claim-time get-or-create (the tick heals).
  const colleagueIdBySlug = new Map<string, string>()
  for (const agent of agents) {
    try {
      const colleague = await getOrCreateContinuingSession(db, {
        userId: input.userId,
        scope: 'agent',
        workspaceId: input.originWorkspaceId,
        scopeRef: agent.slug,
      })
      colleagueIdBySlug.set(agent.slug, colleague.id)
    } catch (err) {
      deps.logger.error({ err, agentSlug: agent.slug }, 'mention colleague resolve failed')
    }
  }

  let dispatched = false
  // The FIRST dispatch's trace key anchors the mention row's pointer (redesign
  // Phase-2b: hand-offs track as pointers under the message that sent them).
  // A multi-mention message points at its first task — the rest reach the
  // rail; recorded limitation. Best-effort like every dispatch here.
  let stampedPointerAnchor = false
  const stampPointerAnchor = (jobId: string, sdkSessionId: string): void => {
    if (stampedPointerAnchor) return
    const job = findDelegationJobById(db, jobId)
    if (job?.partialSessionId == null) return
    stampNewestUserMessageTraceKey(db, {
      sessionId: sdkSessionId,
      partialSessionId: job.partialSessionId,
    })
    stampedPointerAnchor = true
  }
  const onSessionResolved = (sdkSessionId: string): void => {
    if (dispatched || (agents.length === 0 && personas.length === 0)) return
    dispatched = true
    for (const agent of agents) {
      try {
        const colleagueId = colleagueIdBySlug.get(agent.slug)
        const jobId = enqueueAgentRun(db, {
          userId: input.userId,
          parentSessionId: sdkSessionId,
          agentSlug: agent.slug,
          agentName: agent.name,
          taskText: input.userMessageText,
          workspaceId: input.originWorkspaceId,
          runCwdPath: input.originWorkspacePath,
          ...(colleagueId !== undefined ? { targetPrimarySessionId: colleagueId } : {}),
          ...(input.originWorkspaceId !== null
            ? { requesterWorkspaceId: input.originWorkspaceId }
            : {}),
          ...(input.permissionMode !== undefined
            ? { permissionMode: input.permissionMode }
            : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.thinkingEffort !== undefined
            ? { thinkingEffort: input.thinkingEffort }
            : {}),
        })
        stampPointerAnchor(jobId, sdkSessionId)
      } catch (err) {
        deps.logger.error({ err, agentSlug: agent.slug }, 'mention agent-run enqueue failed')
      }
    }
    for (const persona of personas) {
      try {
        const jobId = enqueueWorkspaceDelegation(db, {
          userId: input.userId,
          parentSessionId: sdkSessionId,
          workspaceId: persona.workspaceId,
          workspacePath: persona.workspacePath,
          workspaceName: persona.workspaceName,
          taskText: input.userMessageText,
          ...(input.originWorkspaceId !== null
            ? { requesterWorkspaceId: input.originWorkspaceId }
            : {}),
          ...(input.permissionMode !== undefined
            ? { permissionMode: input.permissionMode }
            : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.thinkingEffort !== undefined
            ? { thinkingEffort: input.thinkingEffort }
            : {}),
        })
        stampPointerAnchor(jobId, sdkSessionId)
      } catch (err) {
        deps.logger.error(
          { err, workspaceId: persona.workspaceId },
          'mention persona delegation enqueue failed',
        )
      }
    }
    deps.logger.info(
      {
        agentSlugs: agents.map((agent) => agent.slug),
        personaWorkspaceIds: personas.map((persona) => persona.workspaceId),
        studyWorkspaceIds: workspaceRefs.map((ref) => ref.workspaceId),
      },
      'composer mentions dispatched',
    )
  }

  return {
    studyDescriptor,
    systemPromptAppend: composeDispatchNote(agents, personas),
    onSessionResolved,
  }
}
