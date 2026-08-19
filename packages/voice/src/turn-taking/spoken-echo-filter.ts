// The shared echo filter — ONE home for "is this transcript the assistant
// hearing its own voice?" Both legs that keep the mic open while speaking run
// every transcript through it: a live call hears Vynel's words come back off
// the far end's speaker (observed verbatim on the 2026-08-16 Meet call — each
// echo then CUT the next line, so Vynel kept interrupting itself), and the
// native wake line hears its own speaker directly. An utterance whose words sit
// word-bounded inside a recently spoken line is that echo; anything else is a
// person — except that a one- or two-word utterance only counts against the
// TAIL of a line, so the barge-in vocabulary survives a long reply that happens
// to contain it. The accepted cost: a human genuinely parroting a phrase of
// Vynel's inside the echo window is swallowed too — far cheaper than the
// self-interruption loop.
//
// Pure + headless: the caller supplies the clock (`performance.now()` units),
// so the window is unit-testable without timers.

/** How long past the END of playback a line's echo can still arrive: the
 *  speaker→mic return (on a call: the round-trip + the far end's pickup) plus
 *  the VAD closing the segment. */
export const ECHO_RETURN_WINDOW_MS = 4_000
/** Echoes only ever mirror the freshest lines — a short memory keeps the
 *  swallow-a-genuine-parrot cost bounded. */
export const ECHO_MEMORY_LINES = 4
/** An utterance this short is the BARGE-IN vocabulary ("stop", "wait", "hold
 *  on", "no thanks") — see `isEchoOfSpokenLine` for why it is matched against
 *  the tail of a line rather than the whole of it. */
const SHORT_UTTERANCE_WORDS = 2
/** About one spoken sentence (the sentence buffer's clause cut) — "what we
 *  just said", as opposed to anywhere in a long reply. */
const RECENT_TAIL_CHARS = 120

/** One line the assistant is speaking (or just spoke). */
export interface SpokenLine {
  /** Grow the line as more of it is spoken — a streamed reply is ONE line, so
   *  an echo that straddles two of its sentences still matches. */
  append(text: string): void
  /** Playback ended (drained or cut): the line stays an echo candidate for the
   *  return window past `now`, then drops out of the filter. */
  end(now?: number): void
}

export interface SpokenEchoFilterOptions {
  readonly returnWindowMs?: number
  readonly memoryLines?: number
}

export class SpokenEchoFilter {
  readonly #returnWindowMs: number
  readonly #memoryLines: number
  #recent: { text: string; hearableUntil: number }[] = []

  constructor(options: SpokenEchoFilterOptions = {}) {
    this.#returnWindowMs = options.returnWindowMs ?? ECHO_RETURN_WINDOW_MS
    this.#memoryLines = options.memoryLines ?? ECHO_MEMORY_LINES
  }

  /** Remember a line from the moment it is HANDED TO THE SPEAKER — writing runs
   *  ahead of playback (a streamed reply is queued far faster than it is heard),
   *  so the window deliberately opens early. It stays open until the handle's
   *  `end()` closes it, because an echo of the line's start can return while
   *  its tail still plays. */
  remember(text: string): SpokenLine {
    const entry = { text, hearableUntil: Number.POSITIVE_INFINITY }
    this.#recent.push(entry)
    if (this.#recent.length > this.#memoryLines) this.#recent.shift()
    return {
      append: (more) => {
        entry.text = entry.text === '' ? more : `${entry.text} ${more}`
      },
      end: (now = performance.now()) => {
        entry.hearableUntil = now + this.#returnWindowMs
      },
    }
  }

  /** The lines a transcript could still be an echo of at `now`. */
  hearableLines(now = performance.now()): string[] {
    return this.#recent.filter((line) => line.hearableUntil > now).map((line) => line.text)
  }

  isEcho(transcript: string, now = performance.now()): boolean {
    return isEchoOfSpokenLine(transcript, this.hearableLines(now))
  }
}

/** The match itself, pure: the heard words sit word-bounded inside one of the
 *  spoken lines, ignoring case and punctuation (STT rarely returns them
 *  verbatim). One or two characters ("a", "it") carry no echo evidence.
 *
 *  A one- or two-word utterance is weighed against the line's TAIL only. A
 *  streamed reply is remembered as one growing line, so by the time the user
 *  talks the haystack is the WHOLE answer — and a long answer that says "stop"
 *  or "wait" anywhere in it would swallow exactly the words people barge in
 *  with. A short utterance is only our own voice if it is what we JUST said;
 *  a longer verbatim run is echo evidence wherever it sits in the line. */
export function isEchoOfSpokenLine(
  transcript: string,
  recentSpokenLines: readonly string[],
): boolean {
  const heard = normalizeForEchoMatch(transcript)
  if (heard.length < 3) return false
  const tailOnly = heard.split(' ').length <= SHORT_UTTERANCE_WORDS
  return recentSpokenLines.some((line) => {
    const spoken = normalizeForEchoMatch(line)
    return ` ${tailOnly ? recentTailOf(spoken) : spoken} `.includes(` ${heard} `)
  })
}

/** The last ~sentence of a spoken line, cut at a word boundary so the slice
 *  never invents one (a half-word would match as a whole word). */
function recentTailOf(spoken: string): string {
  if (spoken.length <= RECENT_TAIL_CHARS) return spoken
  return spoken.slice(-RECENT_TAIL_CHARS).replace(/^\S+\s/, '')
}

function normalizeForEchoMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
