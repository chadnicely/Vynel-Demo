// Sentence-boundary buffering for pipelined TTS (voice-relay-design.md §4;
// the dropped spec's gotcha #4). The relay receives the brain's answer as a
// stream of text deltas. If it waited for the whole reply before speaking,
// the user would hear a long silence then everything at once. Instead it feeds
// each delta here; the buffer emits COMPLETE sentences as their boundary
// arrives, so the shell can synthesize the next sentence while the current one
// plays (always in order, never overlapping).
//
// Pure + stateful (it accumulates across deltas). A sentence boundary is a
// run of .!? followed by whitespace, or a newline — so a decimal like "3.14"
// (period followed by a digit) is never split.

export class SpokenSentenceBuffer {
  #buffer = ''

  // Append a delta; return any complete sentences now ready to speak, in order.
  // The trailing partial sentence stays buffered until its boundary arrives.
  push(textDelta: string): string[] {
    this.#buffer += textDelta
    const sentences: string[] = []
    for (;;) {
      const match = this.#buffer.match(/^[\s\S]*?(?:[.!?]+(?=\s)|\n)/)
      if (!match) break
      const sentence = match[0].trim()
      if (sentence) sentences.push(sentence)
      this.#buffer = this.#buffer.slice(match[0].length)
    }
    return sentences
  }

  // Emit whatever remains — call at turn end so a final sentence that never got
  // a trailing space/newline (the spec's empty/short-result edge) is still spoken.
  flush(): string[] {
    const remainder = this.#buffer.trim()
    this.#buffer = ''
    return remainder ? [remainder] : []
  }
}
