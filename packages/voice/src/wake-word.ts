// Wake-word detection for the background voice service — does an utterance open
// with "hey jarvis", and if so, what's the command after it? PURE + deterministic
// so it's gate-tested; the always-listening capture + Whisper that feed it live in
// the apps/voice shell.
//
// Tolerant by design: Whisper-tiny mishears the (uncommon) name "jarvis" often
// (jarvas, jervis, …) and sprinkles punctuation/casing, so the match accepts a
// small set of greetings + near-spellings at the START of the transcript. A miss
// list is cheaper than a model; widen the variants if a real mishear slips through.

export interface WakeWordResult {
  /** True when the utterance opened with the wake phrase. */
  detected: boolean
  /** The command after the wake phrase — '' when only the wake phrase was said. */
  command: string
}

// greeting + separator + a jarvis-like token, anchored at the start. `/i` covers
// casing; the trailing class eats the punctuation Whisper leaves after the name.
const WAKE_PATTERN =
  /^[\s,.!?-]*(?:hey|hi|hello|okay|ok|yo)[\s,]+(?:jarvis|jarvas|jarviss|jervis|jarvus|jarviz|jarvi)\b[\s,.!?:-]*/i

export function detectWakeWord(transcript: string): WakeWordResult {
  const match = transcript.match(WAKE_PATTERN)
  if (match === null) return { detected: false, command: '' }
  // Slice the ORIGINAL (not a normalized copy) so the command keeps its casing.
  return { detected: true, command: transcript.slice(match[0].length).trim() }
}

// Strip a leading "hey jarvis" / bare "jarvis" that the command capture may have
// caught right after the acoustic wake model fired (it fires mid-utterance). The
// greeting is OPTIONAL here — this only cleans the FRONT of an already-captured
// command; it is NOT wake detection (a bare "jarvis" mid-conversation would
// over-match), so don't use it for that.
const WAKE_PREFIX_PATTERN =
  /^[\s,.!?-]*(?:(?:hey|hi|hello|okay|ok|yo)[\s,]+)?(?:jarvis|jarvas|jarviss|jervis|jarvus|jarviz|jarvi)\b[\s,.!?:-]*/i

export function stripWakePrefix(text: string): string {
  return text.replace(WAKE_PREFIX_PATTERN, '').trim()
}
