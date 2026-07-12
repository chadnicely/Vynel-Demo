// Boundary validation shared by the create + update ops (ONE home — both
// throw the same actionable `ValidationError`s). Limits per the module brief:
// title ≤ 120 chars, body ≤ 50k chars, both nonempty.

import { ValidationError } from '@vynel/errors'

export const MAX_TITLE_LENGTH = 120
export const MAX_BODY_LENGTH = 50_000

export function validateTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('Instruction document title must not be empty — give the book a name.')
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(
      `Instruction document title exceeds ${MAX_TITLE_LENGTH} characters — shorten it (details belong in the body).`,
    )
  }
  return trimmed
}

export function validateBody(body: string): string {
  if (body.trim().length === 0) {
    throw new ValidationError('Instruction document body must not be empty — write the content first.')
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new ValidationError(
      `Instruction document body exceeds ${MAX_BODY_LENGTH} characters — split it into smaller books.`,
    )
  }
  return body
}
