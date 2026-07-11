// The hub's ONE home for JSON-body validation. A bare `zValidator` answers a
// failed parse with raw zod output, breaking the `{code, message}` envelope
// every other hub response uses — this wrapper throws `ValidationError`
// instead, so the app's single onError shapes the 400 like everything else.

import { zValidator } from '@hono/zod-validator'
import type { ZodError, ZodSchema } from 'zod'
import { ValidationError } from '@vynel/errors'

/** Zod issues as one readable line: `path: message; path: message`. */
export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ')
}

export function jsonValidator<Schema extends ZodSchema>(schema: Schema) {
  return zValidator('json', schema, (result) => {
    if (!result.success) throw new ValidationError(formatZodIssues(result.error))
  })
}
