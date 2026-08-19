// `resolveBackgroundTurnSettings` — ONE home for the settings a turn nobody
// composes runs under (session-hardening A5, decisions D3/D4/D8): a delegated
// task, a colleague run, a delivery / update / direct / note turn, a channel
// turn on the global root. The rule everywhere: `job ?? target row ?? DEFAULT`
// — the stamped picks of whoever asked (a tool arg, the creator's resolved
// settings) win; else what the TARGET conversation's user chose for it (its
// head segment's `chat_sessions` row); else the one default (`auto`). No
// surface reaches the provider's `bypass-with-behavior-gate` by falling
// through any more.
//
// The MODEL is fit-checked against the target segment before it runs
// (`fitPinnedModelToSession` — the voice incident's guard, now on every
// background pick that RESUMES the head): a small model resumed onto a fat
// history dies with "Prompt is too long" on a surface with nobody watching.
// A turn that starts a fresh session on the target (a schedule fire) reads
// the row's picks and skips the fit (`startsFreshSession`). Never persisted.
//
// AUTOPILOT (D8): the target row's `autoBuildout` says whether the per-message
// marker rides the provider input — the runner appends it, the caller reads it
// here.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { findChatSessionById } from '@vynel/chat/repositories'
import { resolveTurnSessionSettings } from '@vynel/chat'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import type { DelegationPermissionMode } from '@vynel/orchestration'
import { DEFAULT_SESSION_MODE, toPermissionMode } from '../session-mode.js'
import { fitPinnedModelToSession } from '../runtime/fit-pinned-model-to-session.js'

export type BackgroundTurnSettingsInput = {
  /** The target conversation's HEAD segment (the SDK session the turn will
   *  resume) — null on a first-ever turn (nothing chosen yet, nothing to fit). */
  headSdkSessionId: string | null
  /** Set when the turn starts a FRESH session on the target instead of
   *  resuming the head (a schedule fire — blueprint D3): the head is read for
   *  the user's picks only, and the model is not fit-checked against an
   *  occupancy the new session will not carry. */
  startsFreshSession?: boolean
  /** The stamped picks of whoever asked — the job row's columns. */
  job: {
    permissionMode: DelegationPermissionMode | null
    model: string | null
    thinkingEffort: ThinkingEffortLevel | null
  }
  /** A pick that sits BETWEEN the job and the row — a colleague's own
   *  configured model (`agent.model`) backs a job that named none. */
  fallbackModel?: string | null
  /** The pressure threshold the fit check honors — the same env knob every
   *  continuity consumer uses, so "fits" and "will swap" never disagree. */
  threshold?: number
  logger?: Logger
  /** For the fit-replacement log line. */
  jobId?: string
}

export type BackgroundTurnSettings = {
  permissionMode: DelegationPermissionMode
  model: string | undefined
  thinkingEffort: ThinkingEffortLevel | undefined
  autoBuildout: boolean
}

export function resolveBackgroundTurnSettings(
  db: Database,
  input: BackgroundTurnSettingsInput,
): BackgroundTurnSettings {
  const row = input.headSdkSessionId !== null ? findChatSessionById(db, input.headSdkSessionId) : null
  const fromRow = resolveTurnSessionSettings(
    {
      model: input.job.model ?? input.fallbackModel ?? undefined,
      thinkingEffort: input.job.thinkingEffort ?? undefined,
    },
    row,
  )
  const permissionMode =
    input.job.permissionMode ??
    (fromRow.mode !== undefined
      ? toPermissionMode(fromRow.mode)
      : toPermissionMode(DEFAULT_SESSION_MODE))

  let model = fromRow.model
  if (model !== undefined && input.headSdkSessionId !== null && !input.startsFreshSession) {
    const fit = fitPinnedModelToSession(db, {
      resumeSdkSessionId: input.headSdkSessionId,
      pinnedModel: model,
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    })
    if (fit.wasReplaced) {
      input.logger?.info(
        {
          jobId: input.jobId,
          pinnedModel: model,
          model: fit.model ?? null,
          occupancyTokens: fit.occupancyTokens,
        },
        'background turn: the model pick cannot hold the target occupancy — running on the segment model',
      )
      model = fit.model
    }
  }

  return {
    permissionMode,
    model,
    thinkingEffort: fromRow.thinkingEffort,
    autoBuildout: row?.autoBuildout === true,
  }
}
