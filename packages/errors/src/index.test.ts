// Verifies the contract for the shared VynelError taxonomy. Every domain
// throws these subclasses directly; the HTTP middleware in
// `apps/local-api/src/app.ts onError` has one `instanceof VynelError` check that
// reads `code` + `httpStatus` from the class. Per
// `.claude/rules/error-handling.md` "Taxonomy".

import { describe, it, expect } from 'vitest'
import {
  VynelError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitedError,
} from './index.js'

describe('VynelError taxonomy', () => {
  it('NotFoundError carries the right code + httpStatus + readable message', () => {
    const err = new NotFoundError('user', 'abc-123')
    expect(err).toBeInstanceOf(VynelError)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('not_found')
    expect(err.httpStatus).toBe(404)
    expect(err.message).toContain('user')
    expect(err.message).toContain('abc-123')
    expect(err.resource).toBe('user')
    expect(err.id).toBe('abc-123')
    expect(err.name).toBe('NotFoundError')
  })

  it('NotFoundError without id still produces a usable message', () => {
    const err = new NotFoundError('workspace')
    expect(err.message).toContain('workspace')
    expect(err.id).toBeUndefined()
  })

  it('ConflictError -> 409', () => {
    const err = new ConflictError('email already in use')
    expect(err).toBeInstanceOf(VynelError)
    expect(err.code).toBe('conflict')
    expect(err.httpStatus).toBe(409)
  })

  it('ValidationError -> 400', () => {
    const err = new ValidationError('theme must be light, dark, or system')
    expect(err).toBeInstanceOf(VynelError)
    expect(err.code).toBe('validation_failed')
    expect(err.httpStatus).toBe(400)
  })

  it('UnauthorizedError -> 401', () => {
    const err = new UnauthorizedError('session expired')
    expect(err).toBeInstanceOf(VynelError)
    expect(err.code).toBe('unauthorized')
    expect(err.httpStatus).toBe(401)
  })

  it('ForbiddenError -> 403', () => {
    const err = new ForbiddenError('insufficient scope')
    expect(err).toBeInstanceOf(VynelError)
    expect(err.code).toBe('forbidden')
    expect(err.httpStatus).toBe(403)
  })

  it('RateLimitedError -> 429', () => {
    const err = new RateLimitedError('try again in 30 seconds')
    expect(err).toBeInstanceOf(VynelError)
    expect(err.code).toBe('rate_limited')
    expect(err.httpStatus).toBe(429)
  })

  it('cause is preserved when passed through ErrorOptions', () => {
    const cause = new Error('underlying driver failure')
    const err = new ConflictError('save failed', { cause })
    expect(err.cause).toBe(cause)
  })
})
