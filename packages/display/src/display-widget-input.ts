// The write boundary's validator — the ONE place a caller's title and content
// are checked before they reach a row. `add` and `update` share it so an
// update can never slip past a rule an add enforces.
//
// The byte ceiling is checked on the SERIALIZED content rather than trusting
// the per-field caps: a table of 200 legal rows can still add up past 32 KB,
// and that whole JSON rides every live frame.

import { ValidationError } from '@vynel/errors'
import {
  DISPLAY_TITLE_MAX_LENGTH,
  DISPLAY_WIDGET_SIZES,
  DISPLAY_WIDGET_SLOTS,
  DISPLAY_WIDGET_CONTENT_MAX_BYTES,
  DisplayWidgetContentSchema,
  DisplayWidgetTitleSchema,
  measureDisplayWidgetContentBytes,
  type DisplayWidgetContent,
  type DisplayWidgetSize,
  type DisplayWidgetSlot,
} from '@vynel/contracts/display/display-widget-content'

export function parseDisplayWidgetTitle(title: string): string {
  const parsed = DisplayWidgetTitleSchema.safeParse(title)
  if (!parsed.success) {
    throw new ValidationError(
      `A widget title must be 1-${DISPLAY_TITLE_MAX_LENGTH} characters: ${parsed.error.issues[0]?.message ?? 'invalid title'}.`,
    )
  }
  return parsed.data
}

export function parseDisplayWidgetContent(content: DisplayWidgetContent): DisplayWidgetContent {
  const parsed = DisplayWidgetContentSchema.safeParse(content)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
    throw new ValidationError(
      `This widget's content is invalid${where}: ${issue?.message ?? 'unrecognized shape'}.`,
    )
  }

  const bytes = measureDisplayWidgetContentBytes(parsed.data)
  if (bytes > DISPLAY_WIDGET_CONTENT_MAX_BYTES) {
    throw new ValidationError(
      `This widget's content is ${bytes} bytes; the limit is ${DISPLAY_WIDGET_CONTENT_MAX_BYTES}. Show less on the card and keep the detail in the reply.`,
    )
  }
  return parsed.data
}

/** `slot` arrives typed but unverified, and an unknown one is not cosmetic:
 *  the board's order comes from `DISPLAY_WIDGET_SLOTS.indexOf(slot)`, which
 *  answers -1 for a stranger — the card would sort ahead of every real slot
 *  and no renderer would claim it. Checked against that same array. */
export function parseDisplayWidgetSlot(slot: DisplayWidgetSlot): DisplayWidgetSlot {
  if (!DISPLAY_WIDGET_SLOTS.includes(slot)) {
    throw new ValidationError(
      `"${String(slot)}" is not a Display slot. Use one of: ${DISPLAY_WIDGET_SLOTS.join(', ')}.`,
    )
  }
  return slot
}

export function parseDisplayWidgetSize(size: DisplayWidgetSize): DisplayWidgetSize {
  if (!DISPLAY_WIDGET_SIZES.includes(size)) {
    throw new ValidationError(
      `"${String(size)}" is not a Display widget size. Use one of: ${DISPLAY_WIDGET_SIZES.join(', ')}.`,
    )
  }
  return size
}
