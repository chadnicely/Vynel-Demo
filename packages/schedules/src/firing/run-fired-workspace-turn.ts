// The WORKSPACE branch of a schedule fire — runs the MCP-equipped headless
// `startChatTurn` on the schedule's workspace and drives the ChatTurnEvent
// stream to completion, accumulating the answer text and reporting the chat
// session id the moment the stream names it (the run row binds it while the
// turn still runs). Split out of `fire-schedule.ts` when the global branch
// landed (background-turns BT1) so the executor reads as the three delivery
// paths and this file as "how a workspace turn is fired".
//
// Mirrors the desktop SSE route (`apps/local-api/src/streams/chat-turn.ts`)
// and the delegated runners: `startChatTurn` + the settings resolution + the
// MCP / capability composition are INJECTED via `deps` (the leaf never imports
// the chat or session leaves — invariant #2); the workspace read goes through
// the KERNEL workspaces repo. The turn's settings are `target row ?? DEFAULT`
// (BT2, session-hardening D5/D8): the workspace primary's mode / model /
// effort / autopilot, fit-clamped by the injected resolver — no hard-coded
// unattended mode any more. Schedules always start a FRESH session
// (resumeSessionId omitted — blueprint D3).

import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Schedule } from '../repositories/index.js'
import type { FireScheduleDeps, ScheduleFireFrame } from '../schedules-types.js'

export interface RunFiredWorkspaceTurnInput {
  schedule: Schedule & { workspaceId: string }
  renderedPrompt: string
  /** The fire frame the executor composed (schedule-fire framing): the model
   *  reads prompt + marker, the persisted row is the plain prompt attributed
   *  to the schedule as a system notice. */
  frame: ScheduleFireFrame
  scheduleRunId: string
  /** Called with the chat session id as soon as the stream names one (and
   *  again on a mid-turn swap) — the executor binds it to the run row. */
  onSessionResolved: (chatSessionId: string) => void
}

export interface FiredTurnOutcome {
  chatSessionId: string | null
  producedText: string
}

export async function runFiredWorkspaceTurn(
  db: Database,
  input: RunFiredWorkspaceTurnInput,
  deps: FireScheduleDeps,
): Promise<FiredTurnOutcome> {
  const { schedule, renderedPrompt, scheduleRunId } = input
  // The owner check the workspaces core `getWorkspaceById` did is reproduced
  // inline (same NotFoundError for not-found and not-owned; no enumeration
  // leak). Caught by the executor → run marked 'failed'.
  const workspace = findWorkspaceById(db, schedule.workspaceId)
  if (!workspace || workspace.userId !== schedule.userId) {
    throw new NotFoundError('workspace', schedule.workspaceId)
  }

  // Compose the workspace MCP attachment for THIS turn — the full route-derived
  // `vynel` server + its allow pattern, via the SAME composeSessionMcpServers
  // step the chat + global-root turns use.
  const composedMcp = deps.composeWorkspaceMcpServers({
    db,
    userId: schedule.userId,
    workspaceId: workspace.id,
  })
  // The workspace's capability PROMPT for THIS turn (Vynel rules + enabled-
  // capability contributions like the memory snapshot).
  const composed = deps.composeSessionCapabilities(db, { workspaceId: workspace.id })
  // The turn's settings — the workspace primary's row, else the defaults (BT2).
  const settings = deps.resolveWorkspaceTurnSettings(db, {
    userId: schedule.userId,
    workspaceId: workspace.id,
  })

  const turnStream = deps.startChatTurn(
    db,
    {
      userId: schedule.userId,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      providerId: DEFAULT_PROVIDER_ID,
      userMessageText: renderedPrompt,
      // The frame (schedule-fire framing): what the MODEL reads carries the
      // fire marker; the persisted row stays the plain prompt, attributed to
      // the schedule so the transcript shows a quiet system notice — an
      // unframed fire rendered as "You · <prompt>" and the model treated the
      // instruction as the user asking.
      providerUserMessageText: `${renderedPrompt}\n\n${input.frame.marker}`,
      messageAttribution: { userSourceKind: 'system', userSourceLabel: input.frame.sourceLabel },
      scheduleRunId,
      permissionMode: settings.permissionMode,
      ...(settings.model !== undefined ? { model: settings.model } : {}),
      ...(settings.thinkingEffort !== undefined ? { thinkingEffort: settings.thinkingEffort } : {}),
      ...(settings.autoBuildout ? { autoBuildout: true } : {}),
      mcpServers: composedMcp.mcpServers,
      deniedToolNames: composedMcp.deniedMcpToolPatterns,
      // Capability prompt + the MCP composer's per-feature prompt sections
      // (the chat-turn join).
      systemPromptAppend: [composed.systemPromptAppend, composedMcp.systemPromptAppend]
        .filter((section) => section !== '')
        .join('\n\n'),
      // A feature's declared mutating tools card even under bypass (additive to
      // the static floor).
      ...(composedMcp.mutatingToolNames.length > 0
        ? { alwaysRequireApprovalToolNames: composedMcp.mutatingToolNames }
        : {}),
      // The destructive tier — live when the resolved mode is ask, inert otherwise.
      ...(composedMcp.askModeApprovalToolNames.length > 0
        ? { askModeApprovalToolNames: composedMcp.askModeApprovalToolNames }
        : {}),
    },
    deps.logger !== undefined ? { logger: deps.logger } : {},
  )

  // Consume the real ChatTurnEvent union. Accumulate assistant text; capture
  // the SDK-assigned session id; detect a provider error. Approvals during a
  // scheduled turn are handled in-process by the approvals registry;
  // schedules adds no bespoke approval handling.
  const assistantTextChunks: string[] = []
  let chatSessionId: string | null = null
  let turnErrorMessage: string | null = null
  for await (const event of turnStream) {
    if (event.kind === 'session-created') {
      chatSessionId = event.session.id
      input.onSessionResolved(chatSessionId)
    } else if (event.kind === 'text-chunk') {
      assistantTextChunks.push(event.textDelta)
    } else if (event.kind === 'session-errored') {
      turnErrorMessage = event.errorMessage
    }
  }
  if (turnErrorMessage) {
    throw new Error(turnErrorMessage)
  }
  return { chatSessionId, producedText: assistantTextChunks.join('') }
}
