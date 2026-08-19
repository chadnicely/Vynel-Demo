// Handler for the `usage-reported` variant of the session-event stream. Extracted
// from `consume-session-event-stream.ts` per structure-standard.md "File size cap"
// (the session unification grew the file past 300 — mirrors the existing
// `handle-session-started` / `handle-approval-requested` extractions).
//
// Persists per-message occupancy + the session counters + the session model +
// the context-window DENOMINATOR, and returns the UI `usage-reported` event plus
// the (possibly advanced) session model — `sessionModel` is loop state in the
// consumer, so it's threaded in/out rather than closed over.
//
// THE DENOMINATOR (`lastContextWindow`, session-hardening 2026-08-19): the window
// the occupancy is measured against — by the boundary swap, the fit guard, the
// meter. It is the window of the model the CONVERSATION IS DRIVEN ON: the
// session's chosen model (`selectedModel`, the composer chip, copied forward on
// swaps) when one is set, else the model that produced this report. Why chosen-
// first: a chain the user drives on a 1M model must not start swapping at 17%
// because a delegated small-model visitor filled ITS window, and a chain the
// user drives on a small model must swap before the user's next turn even
// when a big-model visitor pushed it past that window — the visitor's own
// ceiling is the live nudge's business (it reads the running model), the
// chain's ceiling is this column's. With no chosen model (channel-born, voice,
// delegated-only identities) the model that ran is the best truth. Written
// beside `lastContextTokens` on every report so the pair never disagrees.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { ChatMessage } from '../repositories/index.js'
import type { NormalizedSessionEvent } from '@vynel/providers'
import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'
import type { ChatTurnEvent } from '../chat-turn-event.js'

export type HandleUsageReportedInput = {
  db: Database
  event: Extract<NormalizedSessionEvent, { kind: 'usage-reported' }>
  sessionId: string | null
  sessionModel: string | null
  assistantMessageByMessageId: Map<string, ChatMessage>
}

export type HandleUsageReportedResult = {
  event: ChatTurnEvent
  /** The session model after this event (advanced when the event first reports it). */
  sessionModel: string | null
}

export function handleUsageReported(input: HandleUsageReportedInput): HandleUsageReportedResult {
  const { db, event, sessionId, assistantMessageByMessageId } = input
  let sessionModel = input.sessionModel

  const cacheReadInputTokens = event.cacheReadInputTokens ?? 0
  const cacheCreationInputTokens = event.cacheCreationInputTokens ?? 0
  // Real context-window occupancy = the full input side of THIS assistant request
  // (input + cache read + cache creation; the Agent SDK caches heavily). Usage rides
  // on each assistant message — the LAST of a turn is the current occupancy (NOT the
  // cumulative result-message usage, which over-counts a multi-tool-call turn). See
  // .claude/plans/chat-model-and-context-usage-research.md.
  const contextTokens = event.inputTokens + cacheReadInputTokens + cacheCreationInputTokens
  if (sessionId) {
    // One report per assistant message, so counters accrue per persisted message —
    // D8 "on every message persist", NOT per turn. messageCount tracks each assistant
    // row (a tool-loop turn persists several); summing each message's input/output
    // yields the turn's billed total.
    chatRepository.incrementChatSessionCounters(db, sessionId, {
      messageCountDelta: 1,
      inputTokensDelta: event.inputTokens,
      outputTokensDelta: event.outputTokens,
    })
    // The session-level occupancy mirror — the sessions panel + the root's
    // list_sessions read it without joining messages. Overwritten per report;
    // the LAST of a turn IS the current occupancy. The model rides the same
    // update when it first reports (what actually ran), and the denominator
    // rides every report (chosen model first — see the header).
    const advancedModel = event.model && event.model !== sessionModel ? event.model : null
    const denominatorModel =
      chatRepository.findChatSessionById(db, sessionId)?.selectedModel ?? event.model ?? sessionModel
    chatRepository.updateChatSession(db, sessionId, {
      lastContextTokens: contextTokens,
      ...(advancedModel !== null ? { model: advancedModel } : {}),
      ...(denominatorModel ? { lastContextWindow: resolveContextWindow(denominatorModel) } : {}),
    })
    if (advancedModel !== null) sessionModel = advancedModel
  }
  // Persist occupancy onto the assistant message this usage belongs to (by messageId);
  // fall back to the most-recent assistant row if the id didn't resolve (defensive —
  // the row is created by text/tool events).
  const assistantMessage =
    (event.messageId ? assistantMessageByMessageId.get(event.messageId) : undefined) ??
    Array.from(assistantMessageByMessageId.values()).at(-1)
  if (assistantMessage) {
    chatRepository.updateChatMessage(db, assistantMessage.id, {
      inputTokens: contextTokens,
      outputTokens: event.outputTokens,
    })
  }

  return {
    event: {
      kind: 'usage-reported',
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    },
    sessionModel,
  }
}
