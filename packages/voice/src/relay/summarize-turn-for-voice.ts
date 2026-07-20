// Reduce a finished background turn (a delegated /root/turn stream) into ONE
// short line the voice relay speaks. This is the "progress → speech" half of the
// async fire-and-notify design (.claude/ceo/agent-base/voice-relay-design.md §4):
// when a backgrounded task finishes, the relay barges in with a spoken summary —
// never the raw markdown the brain produced.
//
// Pure: input is the turn's events, output is a spoken line. No I/O, no SDK.

import type { NormalizedSessionEvent } from '@vynel/providers'
import { toSpokenGist } from './spoken-gist.js'

export type VoiceTurnOutcome = 'completed' | 'failed' | 'interrupted'

export interface VoiceTurnSummary {
  outcome: VoiceTurnOutcome
  spokenText: string
}

export function summarizeTurnForVoice(
  label: string,
  events: readonly NormalizedSessionEvent[],
): VoiceTurnSummary {
  let outcome: VoiceTurnOutcome = 'completed'
  let errorMessage: string | null = null
  const textParts: string[] = []

  for (const event of events) {
    if (event.kind === 'text-chunk') {
      textParts.push(event.textDelta)
    } else if (event.kind === 'session-errored') {
      outcome = 'failed'
      errorMessage = event.errorMessage
    } else if (event.kind === 'session-interrupted') {
      // An interrupt is terminal unless a later error supersedes it.
      if (outcome !== 'failed') outcome = 'interrupted'
    }
  }

  if (outcome === 'failed') {
    const reason = toSpokenGist(errorMessage ?? '') || 'an unknown error'
    return { outcome, spokenText: `${label} ran into a problem: ${reason}` }
  }
  if (outcome === 'interrupted') {
    return { outcome, spokenText: `${label} was interrupted before it finished.` }
  }

  // Completed. Speak the gist if the turn produced text; otherwise a clean
  // fallback (the spec's empty-result case — a turn can finish with no text).
  const gist = toSpokenGist(textParts.join(''))
  return { outcome, spokenText: gist ? `${label} is done. ${gist}` : `${label} is done.` }
}
