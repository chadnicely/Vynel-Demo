// Strip one-time / 2FA verification codes from notification text BEFORE it
// enters the buffer (redaction-at-ingest — the raw code is never stored and
// never reaches the agent; locked privacy posture, see README).
//
// Best-effort, NOT a guarantee — documented as such. The bias is toward
// privacy: a 6-digit order number occasionally redacted is an acceptable cost
// of never leaking a 2FA code. Single/short digit runs ("3 new messages",
// 4-digit times/years without code context) are deliberately preserved.

const REDACTED = '[redacted code]'

// Presence of any of these turns on aggressive (4–8 digit) redaction for the
// whole notification text.
const CODE_CONTEXT =
  /\b(?:code|otp|one[-\s]?time|verification|verify|passcode|2fa|two[-\s]?factor|authentication code|security code|pin)\b/i

// Letter-prefixed code, e.g. Google's "G-557312".
const LETTER_PREFIXED_CODE = /\b[A-Za-z]-\d{4,8}\b/g
// Two digit groups split by a single space/hyphen, e.g. "458 219", "4821-90".
const SEPARATED_CODE = /\b\d{3,4}[\s-]\d{2,4}\b/g
// A contiguous 4–8 digit run (only redacted when code context is present).
const CONTEXTUAL_DIGIT_RUN = /\b\d{4,8}\b/g
// The canonical bare OTP length — redacted even without surrounding context,
// since a standalone 6-digit run is overwhelmingly a code in a notification.
const BARE_SIX_DIGIT_CODE = /\b\d{6}\b/g

export function redactOneTimeCodes(text: string): string {
  if (text.length === 0) {
    return text
  }
  let redacted = text
  if (CODE_CONTEXT.test(text)) {
    redacted = redacted.replace(LETTER_PREFIXED_CODE, REDACTED)
    redacted = redacted.replace(SEPARATED_CODE, REDACTED)
    redacted = redacted.replace(CONTEXTUAL_DIGIT_RUN, REDACTED)
  }
  redacted = redacted.replace(BARE_SIX_DIGIT_CODE, REDACTED)
  return redacted
}
