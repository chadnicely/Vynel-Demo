// The MID-TURN context nudge (docs/module-notes/session-continuity.md §4.6):
// what the model is told, beside a tool result, once its live context crosses
// the swap threshold while it is still working. Crossing is not a cliff — the
// headroom to the hard limit is real (15% of 1M is 150k tokens; of 200k only
// 30k), so the nudge quotes TOKENS as well as the percentage and asks for a
// clean cut: finish the slice, `checkpoint` the next step, end the turn with
// one line to the user. The boundary swap then runs (visible), and a pending
// checkpoint continues the work on the fresh context automatically.
//
// ONE home for the text and the cadence: fires once when the threshold is
// crossed, then again at every further +5% of the window while the turn keeps
// going (a model that ignored the first line hears it again, sharper — never
// on every tool result). Pure state per turn: the caller builds one nudge per
// turn and hands it to the provider's PostToolUse channel.
//
// A turn that ENDS over the threshold needs no nudge — the boundary swap fires
// on its own; this is only for the turn that has more work than context.

import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'
import { DEFAULT_CONTEXT_PRESSURE_THRESHOLD } from './detect-context-pressure.js'

export type ContextNudgeInput = {
  /** The swap threshold in force (the env smoke knob); default 0.85. */
  threshold?: number
  /** The checkpoint tool's name as the model sees it; default `checkpoint`. */
  checkpointToolName?: string
}

/** The provider's live state at a tool result — the last assistant request's
 *  input side + the model (null before the model is known). */
export type LiveContextState = { usedTokens: number; model: string | null }

// After the first nudge, remind again each time the turn burns another
// slice of the window — enough to be heard, never a nag on every tool call.
const REMINDER_STEP = 0.05

function formatTokens(count: number): string {
  return count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`
    : `${Math.round(count / 1_000)}k`
}

export function composeContextNudgeText(input: {
  usedTokens: number
  contextWindow: number
  threshold: number
  isReminder: boolean
  checkpointToolName: string
}): string {
  const percent = Math.round((input.usedTokens / input.contextWindow) * 100)
  const remaining = Math.max(0, input.contextWindow - input.usedTokens)
  const opener = input.isReminder
    ? `CONTEXT CHECK (from Vynel, not the user) — still going: you are now at ${percent}% of your context`
    : `CONTEXT CHECK (from Vynel, not the user): you have crossed ${Math.round(input.threshold * 100)}% of your context — ${percent}% used`
  return (
    `${opener} (${formatTokens(input.usedTokens)} of ${formatTokens(input.contextWindow)} tokens; about ` +
    `${formatTokens(remaining)} remain before the hard limit). Finish the slice you are on — do not start ` +
    `another large one — then call the \`${input.checkpointToolName}\` tool with the single next step, and end ` +
    `this turn with one line telling the user you will continue after patching context. Vynel will ` +
    `continue you on a fresh context automatically; nothing is lost.`
  )
}

/** Build one turn's nudge: the provider's PostToolUse channel calls it with
 *  the live state after every main-thread tool result. */
export function buildContextNudge(input: ContextNudgeInput = {}): (state: LiveContextState) => string | null {
  const threshold = input.threshold ?? DEFAULT_CONTEXT_PRESSURE_THRESHOLD
  const checkpointToolName = input.checkpointToolName ?? 'checkpoint'
  // The next ratio at which to speak: the threshold first, then +5% steps.
  let nextNudgeAt = threshold
  let hasNudged = false
  return (state) => {
    const contextWindow = resolveContextWindow(state.model)
    const ratio = state.usedTokens / contextWindow
    if (ratio < nextNudgeAt) return null
    const text = composeContextNudgeText({
      usedTokens: state.usedTokens,
      contextWindow,
      threshold,
      isReminder: hasNudged,
      checkpointToolName,
    })
    hasNudged = true
    // Arm the next reminder another 5% of the window past where we are now.
    nextNudgeAt = ratio + REMINDER_STEP
    return text
  }
}
