// The executor — fires a schedule and co-commits the terminal writes (+ the
// optional channel outbox event) in one sync transaction. THREE delivery paths:
// a VERBATIM template (a plain reminder) skips the turn entirely and delivers
// the rendered prompt as-is — as a quiet signed notice on the destination
// conversation (schedule-gaps G2) and, when the destination has one, to the
// channel — with no chat session; a WORKSPACE schedule runs an
// MCP-equipped headless `startChatTurn` on its workspace
// (`run-fired-workspace-turn.ts`); a GLOBAL schedule (null workspaceId) runs a
// GLOBAL-ROOT turn on the user's global conversation (background-turns BT1 —
// the same runner channels use, bound api-side). async (the LLM paths drive
// the provider stream).
//
// Every turn dep is INJECTED via `deps` (the leaf never imports the chat /
// session leaves — invariant #2); the api-side binder
// (`apps/local-api/src/sessions/build-schedule-fire-deps.ts`) wraps each turn
// in the workspace target lock + the delegated hard cap, so a capped fire
// lands here as a thrown cap error → run 'failed' + the run-failed event.
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
import { withTransaction } from '@vynel/db'
import { findScheduleTemplateByKind } from '@vynel/contracts/schedules/schedule-template-catalog'
import * as schedulesRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { scheduleSourceLabel } from '@vynel/contracts/schedules/schedule-source-label'
import { renderSchedulePrompt } from '../rendering/render-schedule-prompt.js'
import {
  renderScheduleChannelMessage,
  formatScheduledTime,
} from '../rendering/render-schedule-channel-message.js'
import { extractErrorMessage } from '../extract-error-message.js'
import {
  SCHEDULE_RUN_COMPLETED_EVENT_TYPE,
  SCHEDULE_RUN_FAILED_EVENT_TYPE,
} from '../schedules-events.js'
import { runFiredWorkspaceTurn, type FiredTurnOutcome } from './run-fired-workspace-turn.js'
import type { Database } from '@vynel/db'
import type { Schedule, ScheduleRun, ScheduleRunTriggerKind } from '../repositories/index.js'
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

    const outcome: FiredTurnOutcome = deliversVerbatim
      ? { chatSessionId: null, producedText: renderedPrompt }
      : await runFiredTurn(
          db,
          { schedule, renderedPrompt, runId, scheduledFireAt: input.scheduledFireAt },
          deps,
        )
    const { chatSessionId, producedText } = outcome

    const renderedOutput = renderScheduleChannelMessage(
      schedule,
      producedText,
      input.scheduledFireAt,
    )

    // Terminal writes co-commit in ONE sync transaction (the outbox event is
    // atomic with the state change — data-standard "Cross-domain
    // communication"). insertOutboxEvent is sync.
    const completedAt = new Date()
    // A ref, not a `let`: the write happens inside the transaction callback and
    // the log line below must see what it answered.
    const chatNotice: { outcome: 'written' | 'no-thread' | 'already-latest' | null } = {
      outcome: null,
    }
    withTransaction(db, (tx) => {
      // The verbatim path's CHAT leg (schedule-gaps G2). The LLM paths write
      // their own row through the turn; verbatim runs no turn, so its reminder
      // reached the channel and nothing else — a chat-only reminder landed
      // NOWHERE. The body stays the rendered prompt word for word (that is the
      // whole point of the template); the schedule signs it as the author.
      if (deliversVerbatim) {
        chatNotice.outcome = deps.recordScheduleChatNotice(tx, {
          userId: schedule.userId,
          workspaceId: schedule.workspaceId,
          sourceLabel: scheduleSourceLabel(schedule.displayName),
          body: renderedPrompt,
        })
      }
      schedulesRepository.updateScheduleRun(tx, runId, {
        status: 'completed',
        completedAt,
        chatSessionId,
      })
      schedulesRepository.updateSchedule(tx, schedule.id, { lastFiredAt: input.scheduledFireAt })
      // chat-and-channel delivers the result to the channel. The LLM paths need
      // a chatSessionId; the verbatim path has none (no session) but still
      // delivers — so the gate accepts either.
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

    // A scope with no conversation yet has no head to write on — the reminder
    // is lost and this line is its only trace (the shared note home's contract;
    // minting a session here is not this path's job).
    if (chatNotice.outcome === 'no-thread') {
      deps.logger?.warn(
        { scheduleId: schedule.id, runId, workspaceId: schedule.workspaceId },
        'schedule reminder: no conversation to land the chat notice on',
      )
    }
    deps.logger?.info({ scheduleId: schedule.id, runId, chatSessionId }, 'schedule fired')
    return schedulesRepository.getScheduleRunByIdOrThrow(db, runId)
  } catch (err) {
    const errorMessage = extractErrorMessage(err)
    const failedAt = new Date()
    // The failed run and its outbox event co-commit — a failure the user never
    // hears about is the bug this event exists to fix (the run row has no UI;
    // core's registry turns the event into a global-root report delivery, and
    // monitors can watch it).
    withTransaction(db, (tx) => {
      schedulesRepository.updateScheduleRun(tx, runId, {
        status: 'failed',
        statusMessage: errorMessage,
        completedAt: failedAt,
      })
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: SCHEDULE_RUN_FAILED_EVENT_TYPE, // 'schedule.run-failed'
        payload: {
          scheduleId: schedule.id,
          runId,
          userId: schedule.userId,
          workspaceId: schedule.workspaceId,
          scheduleDisplayName: schedule.displayName,
          errorMessage,
          firedAt: input.scheduledFireAt.toISOString(),
        },
        createdAt: failedAt,
        processedAt: null,
      })
    })
    deps.logger?.warn({ error: errorMessage, scheduleId: schedule.id, runId }, 'schedule fire failed')
    return schedulesRepository.getScheduleRunByIdOrThrow(db, runId)
  }
}

/** The LLM branch: a WORKSPACE schedule runs its workspace turn; a GLOBAL one
 *  (null workspaceId) runs a global-root turn (BT1). Either way the run row
 *  binds the chat session the moment the stream names it, and the turn runs
 *  under ONE fire frame (schedule-fire framing): the model reads the prompt as
 *  the scheduler firing "<name>" now, the persisted row keeps the plain prompt
 *  attributed to the schedule — never as the user typing. */
async function runFiredTurn(
  db: Database,
  input: { schedule: Schedule; renderedPrompt: string; runId: string; scheduledFireAt: Date },
  deps: FireScheduleDeps,
): Promise<FiredTurnOutcome> {
  const { schedule, renderedPrompt, runId } = input
  const onSessionResolved = (chatSessionId: string): void => {
    schedulesRepository.updateScheduleRun(db, runId, { chatSessionId })
  }
  const frame = {
    marker: deps.renderScheduleFireMarker({
      scheduleDisplayName: schedule.displayName,
      firedAtLocal: formatScheduledTime(input.scheduledFireAt, schedule.timezone),
    }),
    sourceLabel: scheduleSourceLabel(schedule.displayName),
  }
  if (schedule.workspaceId === null) {
    const turn = await deps.startGlobalRootTurn(db, {
      userId: schedule.userId,
      userMessageText: renderedPrompt,
      frame,
      onSessionResolved,
    })
    return { chatSessionId: turn.sessionId, producedText: turn.resultText }
  }
  return runFiredWorkspaceTurn(
    db,
    {
      schedule: { ...schedule, workspaceId: schedule.workspaceId },
      renderedPrompt,
      frame,
      scheduleRunId: runId,
      onSessionResolved,
    },
    deps,
  )
}
