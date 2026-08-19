// The claim-time reads a TASK/NOTE job's run needs — split from the tick
// (session-hardening A6, behaviour-neutral) so `run-task-job.ts` reads as the
// run and this file as "what the row points at":
//
//   - `resolveTaskTarget`: the target's persona + grounding + head segment +
//     (for a colleague target) its agent — ONE fresh read per run.
//   - `resolveDeliverableOrigin`: the job's origin channel as a DELIVERABLE
//     address, shared by the approval push (mid-turn) and the report delivery
//     (completion).

import type { Database } from '@vynel/db'
import type { DelegationJob } from '@vynel/orchestration'
import { findWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findChannelById } from '@vynel/channels'
import * as primarySessionsRepository from '../repositories/index.js'
import { findPrimaryConversation } from '../continuity/index.js'
import { resolveColleagueAgent } from './resolve-colleague-agent.js'
import { resolveSpawnedSessionDisplayName } from './resolve-spawned-session-name.js'
import type { RoutedApprovalOrigin } from './build-routed-approval-handler.js'

/** A colleague (agent-scope) target's agent, resolved fresh at claim time. */
export type TaskColleagueAgent = {
  slug: string
  name: string
  prompt: string
  allowedTools: string[]
  disallowedTools: string[]
  model: string | null
}

export type TaskTarget = {
  /** WORKSPACE target (brain-tree Ch5): manager name + CURRENT workspace
   *  name, falling back to the enqueue-time name if the workspace was
   *  deleted. SESSION target (Slice ④): the spawned session's NAME plays the
   *  manager role (v1, recorded) — one home with the in-flight chip's label. */
  targetName: string
  managerName: string | undefined
  /** Slice ④b: a SESSION target's own workspace grounding (null for a
   *  global-spawned target and every workspace-target job) — picks the MCP
   *  attachment's grounding workspace. */
  spawnedTargetWorkspaceId: string | null
  /** The target conversation's HEAD segment — what the runner will resume,
   *  and whose row holds the settings the user chose for THAT conversation
   *  (session-hardening A5). Null on a first-ever turn. */
  targetHeadSdkSessionId: string | null
  /** Persona-sessions: a session target may be an agent COLLEAGUE — the
   *  delegate + MCP target branch on it. */
  colleagueAgent: TaskColleagueAgent | null
}

export type ResolveTaskTargetResult =
  | { ok: true; target: TaskTarget }
  /** A gone agent or a missing scopeRef on a colleague target — a FAILED
   *  ATTEMPT, not bookkeeping: the caller settles it through the give-up
   *  push so the requester hears about it (the agent-run resolution-phase
   *  rule). */
  | { ok: false; errorMessage: string }

/** Resolve the target's persona ONCE — one fresh read per run. */
export async function resolveTaskTarget(
  db: Database,
  claimed: DelegationJob,
): Promise<ResolveTaskTargetResult> {
  if (claimed.targetPrimarySessionId !== null) {
    const targetPrimary = primarySessionsRepository.findPrimarySessionById(
      db,
      claimed.targetPrimarySessionId,
    )
    const spawnedTargetWorkspaceId = targetPrimary?.workspaceId ?? null
    const targetHeadSdkSessionId = targetPrimary?.currentSdkSessionId ?? null
    if (targetPrimary?.scope === 'agent') {
      // A colleague target: resolve its agent fresh (workspace-then-user,
      // the one home).
      const slug = targetPrimary.scopeRef
      const agent =
        slug !== null
          ? await resolveColleagueAgent(db, {
              userId: claimed.userId,
              workspaceId: targetPrimary.workspaceId,
              slug,
            })
          : null
      if (slug === null || agent === null) {
        return {
          ok: false,
          errorMessage:
            slug === null
              ? 'agent-scope target has no scopeRef (corrupt colleague row)'
              : `no agent "${slug}" resolves for the targeted colleague any more`,
        }
      }
      return {
        ok: true,
        target: {
          targetName: agent.name,
          managerName: undefined,
          spawnedTargetWorkspaceId,
          targetHeadSdkSessionId,
          colleagueAgent: {
            slug,
            name: agent.name,
            prompt: agent.prompt,
            allowedTools: agent.allowedTools ?? [],
            disallowedTools: agent.disallowedTools ?? [],
            model: agent.model,
          },
        },
      }
    }
    return {
      ok: true,
      target: {
        targetName: resolveSpawnedSessionDisplayName(db, targetPrimary),
        managerName: undefined,
        spawnedTargetWorkspaceId,
        targetHeadSdkSessionId,
        colleagueAgent: null,
      },
    }
  }

  const workspace =
    claimed.workspaceId !== null ? findWorkspaceById(db, claimed.workspaceId) : null
  return {
    ok: true,
    target: {
      targetName: workspace?.name ?? claimed.workspaceName ?? 'Workspace',
      managerName: workspace ? resolveManagerName(workspace) : undefined,
      spawnedTargetWorkspaceId: null,
      targetHeadSdkSessionId:
        claimed.workspaceId !== null
          ? (findPrimaryConversation(db, { userId: claimed.userId, workspaceId: claimed.workspaceId })
              ?.currentSdkSessionId ?? null)
          : null,
      colleagueAgent: null,
    },
  }
}

/** Resolve a job's origin channel to a DELIVERABLE address — the shared guard for the
 *  approval push (mid-turn) and the report delivery (completion): the origin columns are
 *  set as a unit; the channel must exist, be enabled, and be owned by the delegation's
 *  user (tenant defense-in-depth — the origin traces to a header read at the boundary). */
export function resolveDeliverableOrigin(
  db: Database,
  claimed: DelegationJob,
): RoutedApprovalOrigin | null {
  if (
    claimed.originChannelId === null ||
    claimed.originExternalSenderId === null ||
    claimed.originExternalChatContextId === null
  ) {
    return null
  }
  const channel = findChannelById(db, claimed.originChannelId)
  if (channel === null || !channel.isEnabled || channel.userId !== claimed.userId) return null
  return {
    channel,
    externalRecipientId: claimed.originExternalSenderId,
    externalChatContextId: claimed.originExternalChatContextId,
  }
}
