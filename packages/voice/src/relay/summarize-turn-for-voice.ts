// Reduce a finished background turn (a delegated /root/turn stream) into ONE
// short line the voice relay speaks. This is the "progress → speech" half of the
// async fire-and-notify design (.claude/ceo/agent-base/voice-relay-design.md §4):
// when a backgrounded task finishes, the relay barges in with a spoken summary —
// never the raw markdown the brain produced.
//
// Pure: input is the turn's events, output is a spoken line. No I/O, no SDK.

import type { NormalizedSessionEvent } from '@vynel/providers'

export type VoiceTurnOutcome = 'completed' | 'failed' | 'interrupted'

export interface VoiceTurnSummary {
  outcome: VoiceTurnOutcome
  spokenText: string
}

// A spoken summary stays short — the brain's full answer lives in the chat
// transcript; voice gets the gist.
const MAX_SPOKEN_LENGTH = 240

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
    const reason = toSpoken(errorMessage ?? '') || 'an unknown error'
    return { outcome, spokenText: `${label} ran into a problem: ${reason}` }
  }
  if (outcome === 'interrupted') {
    return { outcome, spokenText: `${label} was interrupted before it finished.` }
  }

  // Completed. Speak the gist if the turn produced text; otherwise a clean
  // fallback (the spec's empty-result case — a turn can finish with no text).
  const gist = toSpoken(textParts.join(''))
  return { outcome, spokenText: gist ? `${label} is done. ${gist}` : `${label} is done.` }
}

// Make model output safe + short to read aloud: drop markdown markup, collapse
// whitespace, keep the first sentence, cap the length. The list-marker strip
// runs BEFORE the first-sentence scan so "1. Ship it." is not cut to "1.".
function toSpoken(text: string): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // inline links / images → their text
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // reference-style links → their text
    .replace(/<[^>]+>/g, ' ') // autolinks + HTML tags
    .replace(/^[ \t]*(?:\d+\.|[-*+])[ \t]+/gm, '') // leading list markers (per line)
    .replace(/[|]/g, ' ') // table pipes
    .replace(/[*_#>~]/g, '') // emphasis / heading / quote / strike markers
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return ''

  const firstSentence = stripped.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? stripped
  if (firstSentence.length <= MAX_SPOKEN_LENGTH) return firstSentence
  return `${firstSentence.slice(0, MAX_SPOKEN_LENGTH).trim()}…`
}
