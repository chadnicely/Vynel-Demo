// Sentence-boundary buffering for pipelined TTS (voice-relay-design.md §4;
// the dropped spec's gotcha #4). The relay receives the brain's answer as a
// stream of text deltas. If it waited for the whole reply before speaking,
// the user would hear a long silence then everything at once. Instead it feeds
// each delta here; the buffer emits COMPLETE chunks as their boundary arrives,
// so the shell can synthesize the next chunk while the current one plays
// (always in order, never overlapping). The ONE chunker for the daemon's wake
// line, the call leg and the browser players (voice-realtime VR4).
//
// Pure + stateful (it accumulates across deltas). A chunk closes at a SENTENCE
// boundary — a run of .!? (plus any closing quote/bracket/emphasis marker)
// followed by whitespace, or a newline — so a decimal like "3.14" (period
// followed by a digit) is never split. A long sentence does not hold the voice
// hostage: once ~CLAUSE_CUT_CHARS of it are pending it is cut at a CLAUSE break
// (comma, semicolon, colon, a spaced dash) instead — never mid-word, and the
// same chunks whether the text arrives token by token or in one push.

/** Pending text this long is cut at a clause break rather than waiting for
 *  the sentence to end — the first sound waits for a clause, not a paragraph. */
export const CLAUSE_CUT_CHARS = 120;

/** The FIRST chunk of a turn cuts tighter: until something has been spoken,
 *  every buffered character is silence the user sits through, so the opening
 *  clause goes to the speaker at half the normal length. Later chunks keep
 *  the natural rhythm — by then synthesis is pipelined ahead of playback.
 *
 *  The Phase 1 latency pass tried 40 and reverted it the same day: at 40 a
 *  natural two-clause line ("Still working on it — I'll say the answer when
 *  it lands.") splits at the dash into two synthesis calls with a seam the
 *  ear catches, for ~200ms of gain. The real levers were the endpoint
 *  silence window and the synth thread count — this one stays 60. */
export const FIRST_CHUNK_CLAUSE_CUT_CHARS = 60;

const SENTENCE_END = /^[\s\S]*?(?:[.!?]+["'”’)\]*_]*(?=\s)|\n)/;
const CLAUSE_BREAK = /(?:[,;:]["'”’)\]*_]*|\s[-–—]|[–—])(?=\s)/g;

export class SpokenSentenceBuffer {
  #buffer = "";
  #emittedFirstChunk = false;

  // Append a delta; return any complete chunks now ready to speak, in order.
  // The trailing partial stays buffered until its boundary arrives.
  push(textDelta: string): string[] {
    this.#buffer += textDelta;
    return this.#cutReadyChunks();
  }

  // Emit whatever remains — call at turn end so a final sentence that never got
  // a trailing space/newline (the spec's empty/short-result edge) is still spoken.
  flush(): string[] {
    const chunks = this.#cutReadyChunks();
    const remainder = this.#buffer.trim();
    this.#buffer = "";
    if (remainder) chunks.push(remainder);
    return chunks;
  }

  #cutReadyChunks(): string[] {
    const chunks: string[] = [];
    for (;;) {
      const cutAt = this.#nextCut();
      if (cutAt === null) break;
      const chunk = this.#buffer.slice(0, cutAt).trim();
      if (chunk) {
        chunks.push(chunk);
        this.#emittedFirstChunk = true;
      }
      this.#buffer = this.#buffer.slice(cutAt);
    }
    return chunks;
  }

  // The limit depends only on chunks already emitted, so streamed and one-push
  // input still cut identically (the token-by-token invariant).
  #cutLimit(): number {
    return this.#emittedFirstChunk
      ? CLAUSE_CUT_CHARS
      : FIRST_CHUNK_CLAUSE_CUT_CHARS;
  }

  // The sentence end wins unless the sentence is already long; then the clause
  // break closest to the cut length wins (the last one within it, else the
  // first one after it), and a long sentence with no break at all waits for
  // its end like before.
  #nextCut(): number | null {
    const limit = this.#cutLimit();
    const sentenceEnd = this.#buffer.match(SENTENCE_END)?.[0].length ?? null;
    if (sentenceEnd !== null && sentenceEnd <= limit) return sentenceEnd;
    const pendingLength = sentenceEnd ?? this.#buffer.length;
    if (pendingLength < limit) return null;
    return this.#clauseCut(pendingLength, limit) ?? sentenceEnd;
  }

  #clauseCut(before: number, limit: number): number | null {
    let lastWithin: number | null = null;
    for (const match of this.#buffer.slice(0, before).matchAll(CLAUSE_BREAK)) {
      const end = match.index + match[0].length;
      if (end <= limit) lastWithin = end;
      else return lastWithin ?? end;
    }
    return lastWithin;
  }
}
