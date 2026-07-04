// The executor — fires a schedule and co-commits the terminal writes (+ the
// optional channel outbox event) in one sync transaction. TWO delivery paths:
// a NORMAL schedule runs an MCP-equipped headless `startChatTurn` and drives the
// ChatTurnEvent stream to completion; a VERBATIM template (a plain reminder)
// skips the turn entirely and delivers the rendered prompt as-is, with no chat
// session. async (the LLM path drives the provider stream).
//
// Mirrors the desktop SSE route (`apps/api/src/streams/chat-turn.ts`) and
// channels' `routeAsChatTurn`: `startChatTurn` is INJECTED via `deps` (the leaf
// never imports the chat leaf — invariant #2); the workspace read goes through
// the KERNEL workspaces repo; `composeWorkspaceMcpServers` +
// `composeSessionCapabilities` are INJECTED via `deps` (keeps @vynel/mcp + the
// apps/api composer out of the leaf — it stays unit-testable with stubs).
//
// Key invariants (coding.md §1.3 / §1.5):
//  - never advances `nextScheduledFireAt` (only the poll claim does — D12);
//  - the terminal trio (run→completed + lastFiredAt + the outbox event)
//    co-commits in ONE sync withTransaction (atomicity);
//  - the outbox event publishes ONLY on success + chat-and-channel + a set
//    channelId + (a known chatSessionId OR a verbatim template — the verbatim
//    path has no session but still delivers; do NOT tighten the gate back to
//    `&& chatSessionId` or every verbatim reminder silently stops delivering).
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.2`.

import { randomUUID } from 'node:crypto'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { withTransaction } from '@vynel/db'
import { findScheduleTemplateByKind } from '@vynel/contracts/schedules/schedule-template-catalog'
import { findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/errors'
import * as schedulesRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { renderSchedulePrompt } from '../rendering/render-schedule-prompt.js'
import { renderScheduleChannelMessage } from '../rendering/render-schedule-channel-message.js'
import { extractErrorMessage } from '../extract-error-message.js'
import { SCHEDULE_RUN_COMPLETED_EVENT_TYPE } from '../schedules-events.js'
import type { Database } from '@vynel/db'
import type { ScheduleRun, ScheduleRunTriggerKind } from '../repositories/index.js'
import type { FireScheduleDeps } from '../schedules-types.js'

export interface FireScheduleInput {
  scheduleId: string
  scheduledFireAt: Date
  triggerKind: ScheduleRunTriggerKind // 'poll' | 'catchup' | 'manual'
}

export async function fireSchedule(
  db: Database,
  input: FireScheduleInput,
  deps: FireScheduleDeps,
): Promise<ScheduleRun> {
  const schedule = schedulesRepository.findScheduleById(db, input.scheduleId)
  if (!schedule || !schedule.isEnabled) {
    throw new Error(`fireSchedule: schedule ${input.scheduleId} not found or disabled`)
  }

  const runId = randomUUID()
  schedulesRepository.insertScheduleRun(db, {
    id: runId,
    scheduleId: schedule.id,
    scheduledFireAt: input.scheduledFireAt,
    startedAt: new Date(),
    completedAt: null,
    chatSessionId: null,
    status: 'pending',
    statusMessage: null,
    triggerKind: input.triggerKind,
  })

  try {
    schedulesRepository.updateScheduleRun(db, runId, { status: 'running' })

    // Render the prompt (its {{placeholders}} resolved). For a verbatim template
    // this rendered text IS the message delivered; otherwise it's the prompt fed
    // to the LLM turn.
    const renderedPrompt = renderSchedulePrompt(db, {
      promptTemplate: schedule.promptTemplate,
      userId: schedule.userId,
      workspaceId: schedule.workspaceId,
      now: input.scheduledFireAt,
    })

    // A verbatim template (a plain reminder) fires WITHOUT an LLM turn — the
    // user's text arrives as-is, not as a model's rewrite of it. No chat session.
    const deliversVerbatim =
      findScheduleTemplateByKind(schedule.templateKind)?.deliversVerbatim ?? false

    let chatSessionId: string | null = null
    let producedText: string

    if (deliversVerbatim) {
      producedText = renderedPrompt
    } else {
      // A workspace-scoped turn requires a workspace. A GLOBAL schedule (null
      // workspaceId) has none — its natural case is a verbatim reminder handled
      // above; a non-verbatim global turn would need the global-root machinery
      // this leaf does not run, so a null workspace surfaces the same clean
      // NotFoundError as a missing one (caught → run marked 'failed').
      // workspacePath via the KERNEL workspaces repo — the owner check that the
      // workspaces core `getWorkspaceById` did is reproduced inline (same
      // NotFoundError for not-found and not-owned; no enumeration leak).
      const workspace =
        schedule.workspaceId !== null ? findWorkspaceById(db, schedule.workspaceId) : null
      if (!workspace || workspace.userId !== schedule.userId) {
        throw new NotFoundError('workspace', schedule.workspaceId ?? undefined)
      }

      // Compose the workspace MCP attachment for THIS turn — the full route-derived
      // `vynel` server + its allow pattern, via the SAME composeSessionMcpServers
      // step the chat + global-root turns use. Injected via deps (the api-side
      // service binds it) so the leaf never imports @vynel/mcp or the composer.
      const composedMcp = deps.composeWorkspaceMcpServers({
        db,
        userId: schedule.userId,
        workspaceId: workspace.id,
      })

      // Compose the workspace's capability PROMPT for THIS turn (Vynel rules +
      // enabled-capability contributions like the memory snapshot). The tool-deny
      // gate now rides on composeWorkspaceMcpServers above. Injected via deps so
      // the leaf never imports apps/api.
      const composed = deps.composeSessionCapabilities(db, {
        workspaceId: workspace.id,
      })

      // Schedules always start a FRESH session (resumeSessionId omitted — D3).
      const turnStream = deps.startChatTurn(
        db,
        {
          userId: schedule.userId,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          providerId: DEFAULT_PROVIDER_ID,
          userMessageText: renderedPrompt,
          permissionMode: 'bypass-with-behavior-gate', // D10
          mcpServers: composedMcp.mcpServers,
          allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
          deniedToolNames: composedMcp.deniedMcpToolPatterns,
          systemPromptAppend: composed.systemPromptAppend,
          // A feature's declared mutating tools card even under bypass (additive to
          // the static floor).
          ...(composedMcp.mutatingToolNames.length > 0
            ? { alwaysRequireApprovalToolNames: composedMcp.mutatingToolNames }
            : {}),
        },
        deps.logger !== undefined ? { logger: deps.logger } : {},
      )

      // Consume the real ChatTurnEvent union. Accumulate assistant text; capture
      // the SDK-assigned session id; detect a provider error.
      const assistantTextChunks: string[] = []
      let turnErrorMessage: string | null = null

      for await (const event of turnStream) {
        if (event.kind === 'session-created') {
          chatSessionId = event.session.id
          schedulesRepository.updateScheduleRun(db, runId, { chatSessionId })
        } else if (event.kind === 'text-chunk') {
          assistantTextChunks.push(event.textDelta)
        } else if (event.kind === 'session-errored') {
          turnErrorMessage = event.errorMessage
        }
        // Approvals during a scheduled turn are handled in-process by the
        // approvals registry; schedules adds no bespoke approval handling.
      }

      if (turnErrorMessage) {
        throw new Error(turnErrorMessage)
      }
      producedText = assistantTextChunks.join('')
    }

    const renderedOutput = renderScheduleChannelMessage(
      schedule,
      producedText,
      input.scheduledFireAt,
    )

    // Terminal writes co-commit in ONE sync transaction (the outbox event is
    // atomic with the state change — data-standard "Cross-domain
    // communication"). insertOutboxEvent is sync.
    const completedAt = new Date()
    withTransaction(db, (tx) => {
      schedulesRepository.updateScheduleRun(tx, runId, { status: 'completed', completedAt })
      schedulesRepository.updateSchedule(tx, schedule.id, { lastFiredAt: input.scheduledFireAt })
      // chat-and-channel delivers the result to the channel. The LLM path needs a
      // chatSessionId; the verbatim path has none (no session) but still delivers
      // — so the gate accepts either.
      if (
        schedule.destinationKind === 'chat-and-channel' &&
        schedule.channelId &&
        (chatSessionId || deliversVerbatim)
      ) {
        insertOutboxEvent(tx, {
          id: randomUUID(),
          type: SCHEDULE_RUN_COMPLETED_EVENT_TYPE, // 'schedule.run-completed'
          payload: {
            scheduleId: schedule.id,
            userId: schedule.userId,
            workspaceId: schedule.workspaceId,
            channelId: schedule.channelId,
            chatSessionId,
            renderedOutput, // channels enqueues this verbatim — the 📅 header is baked in
            firedAt: input.scheduledFireAt.toISOString(),
          },
          createdAt: completedAt,
          processedAt: null,
        })
      }
    })

    deps.logger?.info({ scheduleId: schedule.id, runId, chatSessionId }, 'schedule fired')
    return schedulesRepository.getScheduleRunByIdOrThrow(db, runId)
  } catch (err) {
    schedulesRepository.updateScheduleRun(db, runId, {
      status: 'failed',
      statusMessage: extractErrorMessage(err),
      completedAt: new Date(),
    })
    deps.logger?.warn(
      { error: extractErrorMessage(err), scheduleId: schedule.id, runId },
      'schedule fire failed',
    )
    return schedulesRepository.getScheduleRunByIdOrThrow(db, runId)
  }
}
