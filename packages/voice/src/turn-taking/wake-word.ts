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

export interface DetectWakeWordOptions {
  /** The user's CUSTOM wake names (Settings → Voice), matched BESIDE the
   *  built-ins — additive, so a name the STT cannot hear never locks the user
   *  out. Matched LOOSELY (edit distance scaled to the name's length), the
   *  same tolerance the hand-tuned garble list gives the built-ins. */
  readonly extraWakeNames?: readonly string[]
}

// greeting + the next word — the custom-name probe. The token after the
// greeting is fuzzy-compared against each custom name; everything after it is
// the command.
const WAKE_GREETING_TOKEN_PATTERN = new RegExp(
  `^[\\s,.!?-]*(?:${WAKE_GREETING})[\\s,]+([\\p{L}\\p{N}']+)[\\s,.!?:-]*`,
  'iu',
)

export function detectWakeWord(
  transcript: string,
  options: DetectWakeWordOptions = {},
): WakeWordResult {
  const match = transcript.match(WAKE_PATTERN)
  if (match !== null) {
    // Slice the ORIGINAL (not a normalized copy) so the command keeps its casing.
    return { detected: true, command: transcript.slice(match[0].length).trim() }
  }
  const extraNames = options.extraWakeNames ?? []
  if (extraNames.length > 0) {
    const candidate = transcript.match(WAKE_GREETING_TOKEN_PATTERN)
    const heardName = candidate?.[1]?.toLowerCase()
    if (candidate !== null && heardName !== undefined) {
      const isCustomName = extraNames.some((name) =>
        isLooseWakeNameMatch(heardName, name.toLowerCase()),
      )
      if (isCustomName) {
        return { detected: true, command: transcript.slice(candidate[0].length).trim() }
      }
    }
  }
  return { detected: false, command: '' }
}

/** How far a heard token may drift from the custom name and still wake: the
 *  same class of tolerance the built-ins get from their garble lists, scaled
 *  to length — a short name allows one slip, a longer one two. Never zero:
 *  tiny STT rarely returns an invented name verbatim. */
function isLooseWakeNameMatch(heard: string, name: string): boolean {
  if (heard === name) return true
  const allowedDistance = name.length <= 5 ? 1 : 2
  if (Math.abs(heard.length - name.length) > allowedDistance) return false
  return levenshteinDistance(heard, name) <= allowedDistance
}

function levenshteinDistance(a: string, b: string): number {
  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row.push(
        Math.min(
          previousRow[j]! + 1,
          row[j - 1]! + 1,
          previousRow[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      )
    }
    previousRow = row
  }
  return previousRow[b.length]!
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
