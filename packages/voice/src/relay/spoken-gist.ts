import { stripSpokenMarkup } from './strip-spoken-markup.js'

// Reduce model prose to ONE line safe + short to read aloud: drop markdown
// markup, collapse whitespace, keep the first sentence, cap the length. Shared
// by the background-turn summary (`summarize-turn-for-voice`) and the overlay's
// no-`speak` fallback — the voice never reads a wall of markdown.

// A spoken line stays short — the full answer lives in the chat transcript;
// voice gets the gist.
const MAX_SPOKEN_LENGTH = 240

export function toSpokenGist(text: string): string {
  // The list-marker strip runs BEFORE the first-sentence scan so "1. Ship it."
  // is not cut to "1.".
  const stripped = stripSpokenMarkup(text)
  if (!stripped) return ''

  const firstSentence = stripped.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? stripped
  if (firstSentence.length <= MAX_SPOKEN_LENGTH) return firstSentence
  return `${firstSentence.slice(0, MAX_SPOKEN_LENGTH).trim()}…`
}
