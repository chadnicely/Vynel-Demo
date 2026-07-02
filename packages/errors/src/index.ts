// The shared `VynelError` taxonomy — one abstract base + six generic
// HTTP-semantic subclasses. Per `.claude/rules/error-handling.md`
// "Taxonomy — one base + small generic set + sparing specialization":
// per-domain `<Domain>NotFoundError` wrappers are forbidden; every domain
// throws these subclasses directly.
//
// This is a dependency-free LEAF package. It lets both `@vynel/core` and
// `@vynel/providers` import the taxonomy without forming a `core <-> providers`
// workspace dependency cycle — `@vynel/core/providers` imports
// `@vynel/providers`, and the providers domain throws `VynelError` subclasses.
// Every consumer imports this package directly as `@vynel/errors`. See
// `.claude/memory/decisions/errors-package-extraction.md`.
//
// The HTTP middleware in `apps/local-api/src/app.ts onError` has a SINGLE
// `instanceof VynelError` check that reads `httpStatus` + `code` from the
// class. The class IS the response shape.

export abstract class VynelError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

export class NotFoundError extends VynelError {
  readonly code = 'not_found'
  readonly httpStatus = 404

  constructor(
    public readonly resource: string,
    public readonly id?: string,
  ) {
    super(id !== undefined ? `${resource} not found: ${id}` : `${resource} not found.`)
  }
}

export class ConflictError extends VynelError {
  readonly code = 'conflict'
  readonly httpStatus = 409
}

export class ValidationError extends VynelError {
  readonly code = 'validation_failed'
  readonly httpStatus = 400
}

export class UnauthorizedError extends VynelError {
  readonly code = 'unauthorized'
  readonly httpStatus = 401
}

export class ForbiddenError extends VynelError {
  readonly code = 'forbidden'
  readonly httpStatus = 403
}

export class RateLimitedError extends VynelError {
  readonly code = 'rate_limited'
  readonly httpStatus = 429
}
