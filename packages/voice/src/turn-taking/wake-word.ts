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

// The demo-film wake — "What's up Pacino" (Chad, 2026-08-28) — kept as its OWN
// greeting × name pairing, never crossed with the lists above: "what's up"
// beside the classic names would fire on overheard dialogue a tiny STT strips
// punctuation from ("What's up?" "Fine." → "whats up fine"), and "casino" (a
// pacino garble AND a common word) beside "hey" would fire on TV audio. Each
// side widens only the other's demo half.
const DEMO_WAKE_NAME = 'pacino|pachino|pacheeno|patchino|puccino|pucino|casino'
const DEMO_WAKE_GREETING = "what'?s[\\s,]+up|wass?up|whassup|sup"

// THE SECOND TRIGGER (Chad, 2026-08-28). On camera the film is a
// conversation: the wake phrase gets the evening update, and then he ASKS for
// the software — "how's our software doing", "how's the dev team doing" — and
// the second half plays. Those are whole questions, not a name, so they wake
// on their own; they are deliberately long and specific, because a two-word
// trigger here would fire on ordinary talk near an always-on microphone.
// The whole question survives as the command, so the surface that answers can
// tell WHICH follow-up was asked.
const DEMO_FOLLOWUP = [
  "how(?:'?s| is| are)[\\s,]+(?:our|the|my)[\\s,]+(?:software|dev|development|dev team|development team|build team|crew|fleet|projects?)",
  "how(?:'?s| is| are)[\\s,]+(?:the[\\s,]+)?(?:dev|development)[\\s,]+(?:team|updates?)",
  "what(?:'?s| is)[\\s,]+(?:the[\\s,]+)?(?:dev|development|software|product)[\\s,]+(?:team[\\s,]+)?(?:updates?|news|doing)",
  "give me[\\s,]+(?:the[\\s,]+)?(?:dev|development|software)[\\s,]+updates?",
  "what(?:'?s| is)[\\s,]+(?:everyone|the team|the crew)[\\s,]+(?:been[\\s,]+)?(?:up to|working on|building)",
].join('|')

const DEMO_FOLLOWUP_PATTERN = new RegExp(`^[\\s,.!?-]*(?:${DEMO_FOLLOWUP})\\b`, 'i')

// THE THIRD TRIGGER (Chad, 2026-08-30). The film is three exchanges and the
// last one is the sign-off — "Thanks Pacino!" — after which the show goes to
// black. It matched nothing at all, so a take could be opened and answered
// but never ended: he said it to camera and the room simply carried on.
//
// The NAME is required. A bare "thanks" is one of the most common words near
// an always-on microphone, and on a set it is said to people constantly.
const DEMO_SIGNOFF = `(?:thanks|thank\\s*you|thankyou|cheers)[\\s,]+(?:${DEMO_WAKE_NAME})`
const DEMO_SIGNOFF_PATTERN = new RegExp(`^[\\s,.!?-]*(?:${DEMO_SIGNOFF})\\b`, 'i')

// greeting + separator + a wake-name token, anchored at the start. `/i` covers
// casing; the trailing class eats the punctuation STT leaves after the name.
const WAKE_PATTERN = new RegExp(
  `^[\\s,.!?-]*(?:(?:${WAKE_GREETING})[\\s,]+(?:${WAKE_NAME})|(?:${DEMO_WAKE_GREETING})[\\s,]+(?:${DEMO_WAKE_NAME}))\\b[\\s,.!?:-]*`,
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
  // The follow-up question wakes as itself and is handed over WHOLE — nothing
  // is peeled off, because the words are the request.
  if (DEMO_FOLLOWUP_PATTERN.test(transcript)) {
    return { detected: true, command: transcript.trim() }
  }
  // The sign-off wakes as itself too — the surface that answers decides what
  // it means, and for the film it means: say goodbye, then go to black.
  if (DEMO_SIGNOFF_PATTERN.test(transcript)) {
    return { detected: true, command: transcript.trim() }
  }
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
 *  to length. A SHORT name gets NO fuzz — the distance-1 ball around a
 *  3-letter name is full of everyday speech ("Max" would take "man"/"mad"/
 *  "mat", and the always-on mic hears the TV too), and short names are real
 *  names tiny STT transcribes fine; the built-ins' common-word garbles were
 *  hand-curated for collisions, an automatic ball is not. */
function isLooseWakeNameMatch(heard: string, name: string): boolean {
  if (heard === name) return true
  const allowedDistance = name.length <= 3 ? 0 : name.length <= 5 ? 1 : 2
  if (allowedDistance === 0) return false
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
