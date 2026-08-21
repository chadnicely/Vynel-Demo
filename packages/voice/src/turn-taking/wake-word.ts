// Wake-word detection for the background voice service — does an utterance open
// with "hey vynel", and if so, what's the command after it? PURE + deterministic
// so it's gate-tested; the always-listening capture + Whisper that feed it live in
// the apps/voice shell.
//
// Tolerant by design: Whisper-tiny mishears these uncommon names often
// (vinel, jervis, …) and sprinkles punctuation/casing, so the match accepts a
// small set of greetings + near-spellings at the START of the transcript. A miss
// list is cheaper than a model; widen the variants if a real mishear slips through.

export interface WakeWordResult {
  /** True when the utterance opened with the wake phrase. */
  detected: boolean
  /** The command after the wake phrase — '' when only the wake phrase was said. */
  command: string
}

// The wake name + the near-spellings STT commonly returns for these uncommon
// words: "vynel" (the product), "claude" (the assistant's display name — the
// UI invites "Hey Claude"), plus a retired legacy name kept only so an early
// user is still heard. "vynel" is invented, so tiny STT mangles it hard —
// observed live: "Hey Vynel" → "hey fine". The list therefore includes
// common-word garbles (fine/final/cloud); widen as more surface.
const WAKE_NAME =
  'jarvis|jarvas|jarviss|jervis|jarvus|jarviz|jarvi|vynel|vinel|vynell|vinell|vinyl|vynal|vinal|vanel|vynol|vino|vinnel|venel|fine|final|claude|claud|clod|clawed|cloud|klaud'

// Greetings that may precede the name. `okay`/`ok` are deliberately OUT: with
// "fine" in the name list they'd fire on the very common "okay, fine …".
const WAKE_GREETING = 'hey|hi|hello|yo'

// greeting + separator + a wake-name token, anchored at the start. `/i` covers
// casing; the trailing class eats the punctuation STT leaves after the name.
const WAKE_PATTERN = new RegExp(
  `^[\\s,.!?-]*(?:${WAKE_GREETING})[\\s,]+(?:${WAKE_NAME})\\b[\\s,.!?:-]*`,
  'i',
)

export function detectWakeWord(transcript: string): WakeWordResult {
  const match = transcript.match(WAKE_PATTERN)
  if (match === null) return { detected: false, command: '' }
  // Slice the ORIGINAL (not a normalized copy) so the command keeps its casing.
  return { detected: true, command: transcript.slice(match[0].length).trim() }
}

// Strip a leading "hey vynel" / bare "vynel" that the command capture may have
// caught right after the acoustic wake model fired (it fires mid-utterance). The
// greeting is OPTIONAL here — this only cleans the FRONT of an already-captured
// command; it is NOT wake detection (a bare "vynel" mid-conversation would
// over-match), so don't use it for that. ⚠ Without the greeting anchor the
// common-word garbles in WAKE_NAME (fine/final/cloud) can eat a command's real
// first word — currently unused in production; tighten the name list here
// before wiring a caller.
const WAKE_PREFIX_PATTERN = new RegExp(
  `^[\\s,.!?-]*(?:(?:${WAKE_GREETING})[\\s,]+)?(?:${WAKE_NAME})\\b[\\s,.!?:-]*`,
  'i',
)

export function stripWakePrefix(text: string): string {
  return text.replace(WAKE_PREFIX_PATTERN, '').trim()
}
