// Did the text actually land?
//
// Every act tool used to report "the action was sent", never "the action
// worked" — and the model then built its next step on that. This session cost
// us that mistake repeatedly at the tool level (a launch that opened the
// Applications folder and reported success, a tray restore that never ran), so
// the same standard belongs on the acting surface: report the VERIFIED outcome.
//
// A click cannot be verified in general — "did that button do what I hoped" has
// no universal answer. Typing CAN: the field has a value, so we read it back.
// That is also where automation silently fails most often — focus moved between
// the resolve and the keystroke, the field rejected the input, or autocomplete
// rewrote it — and all three look identical to success from the caller's side.

export type ActVerification =
  /** The field reads what it should. */
  | { kind: 'confirmed'; actual: string }
  /** The action returned, but the field does NOT hold the text. */
  | { kind: 'mismatch'; intended: string; actual: string }
  /** Could not read the value back — reported honestly rather than assumed. */
  | { kind: 'unverifiable'; reason: string }

/**
 * Compare what we meant to enter with what the field now holds. Pure.
 *
 * The two actions need DIFFERENT comparisons, and conflating them would make
 * one of them permanently wrong:
 * - `set_value` REPLACES the content, so the field must equal the value.
 * - `type_text` types at the cursor into whatever is already there, so the
 *   field must CONTAIN it. Demanding equality would report a false mismatch
 *   every time the model typed into a non-empty field.
 */
export function verifyTypedValue(
  action: 'type_text' | 'set_value',
  intended: string,
  actual: string | null,
  /** What the field held BEFORE. Without it, containment can confirm text the
   *  keystrokes never delivered — see below. */
  before?: string | null,
): ActVerification {
  // A false CONFIRMATION is the dangerous direction (a false mismatch is merely
  // loud), and containment has exactly one: if the field ALREADY contained the
  // text, `type_text` confirms even though the keystrokes went elsewhere.
  // Realistic every day — an autofilled field, a retry after a timeout, the
  // second of two identical batch steps.
  //
  // Note this is NOT `after !== before`: correctly re-typing the same text into
  // a field that already had it is a legitimate no-visible-change, and calling
  // that a mismatch would be its own false alarm. Inconclusive is the honest
  // answer — we cannot tell the two apart from the outside.
  if (action === 'type_text' && intended.length > 0 && before?.includes(intended) === true) {
    return {
      kind: 'unverifiable',
      reason:
        'the field already contained that text before typing, so a read-back cannot tell whether ' +
        'the keystrokes landed or went somewhere else',
    }
  }
  if (actual === null) {
    return {
      kind: 'unverifiable',
      reason: 'the element reports no readable value (some custom-drawn controls do not expose one)',
    }
  }
  const landed = action === 'set_value' ? actual.trim() === intended.trim() : actual.includes(intended)
  return landed ? { kind: 'confirmed', actual } : { kind: 'mismatch', intended, actual }
}

/** How the outcome should be told to the model — the mismatch case has to be
 *  loud, because it is the one that otherwise passes for success. */
export function describeVerification(verification: ActVerification): string {
  switch (verification.kind) {
    case 'confirmed':
      return ` Verified: the field now reads ${JSON.stringify(truncate(verification.actual))}.`
    case 'mismatch':
      return (
        ` ⚠ NOT VERIFIED — the text did not land. The field reads ` +
        `${JSON.stringify(truncate(verification.actual))}, not ` +
        `${JSON.stringify(truncate(verification.intended))}. Something took the keystrokes ` +
        'instead: the focus may have moved, the field may have rejected them, or autocomplete may ' +
        'have rewritten them. Look at the app before doing anything that depends on this.'
      )
    case 'unverifiable':
      return ` NOT confirmed — ${verification.reason}, so check it yourself before relying on it.`
  }
}

/** Values can be whole documents; a verification line should stay a line. */
const MAX_REPORTED_VALUE = 120

function truncate(value: string): string {
  return value.length <= MAX_REPORTED_VALUE ? value : `${value.slice(0, MAX_REPORTED_VALUE)}…`
}
