// The platform's webhook surface (cloud-api.md §4) — WE authored this
// contract; Chad's platform adapts to it:
//
//   POST /platform/webhooks
//   headers: x-vynel-timestamp (epoch seconds)
//            x-vynel-signature (hex hmac-sha256 of `${timestamp}.${rawBody}`)
//   body:    { id, type: user.created|user.updated|user.removed|tier.updated,
//              platformUserId, email?, displayName?, tier?, tierExpiresAt? }
//
// Signature covers timestamp + raw body; a 5-minute replay window bounds
// captured requests. Handlers are idempotent (apply-platform-event.ts), so
// platform retries are always safe. Secret unset = 503 (surface off).

import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { UnauthorizedError, ValidationError, VynelError } from '@vynel/errors'
import { applyPlatformEvent } from '@vynel/accounts'
import { claimPlatformEvent } from '@vynel/cloud-db/repositories/platform-events'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { formatZodIssues } from '../middleware/json-validator.js'

const REPLAY_WINDOW_SECONDS = 5 * 60

const PlatformWebhookSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(['user.created', 'user.updated', 'user.removed', 'tier.updated']),
  platformUserId: z.string().min(1).max(120),
  email: z.string().email().max(320).optional(),
  displayName: z.string().min(1).max(120).optional(),
  tier: z.enum(['basic', 'pro']).optional(),
  tierExpiresAt: z.string().datetime().nullable().optional(),
})

class WebhooksDisabledError extends VynelError {
  readonly code = 'webhooks_disabled'
  readonly httpStatus = 503
}

function verifySignature(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: string,
  nowSeconds: number,
): void {
  if (timestampHeader === undefined || signatureHeader === undefined) {
    throw new UnauthorizedError('Missing x-vynel-timestamp / x-vynel-signature headers.')
  }
  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > REPLAY_WINDOW_SECONDS) {
    throw new UnauthorizedError('Webhook timestamp outside the replay window.')
  }
  // Reject non-hex up front: Buffer.from('hex') never throws, it silently
  // stops at the first invalid nibble (a shorter buffer that the length check
  // below would catch anyway — but an explicit shape check is clearer).
  if (!/^[0-9a-f]{64}$/i.test(signatureHeader)) {
    throw new UnauthorizedError('Webhook signature is not a valid sha256 hex digest.')
  }
  const expected = createHmac('sha256', secret).update(`${timestampHeader}.${rawBody}`).digest()
  const presented = Buffer.from(signatureHeader, 'hex')
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new UnauthorizedError('Webhook signature mismatch.')
  }
}

export function buildPlatformRoutes(options: CloudAppOptions) {
  const linkDeps = {
    mail: options.mail,
    linkBaseUrl: options.linkBaseUrl,
    ...(options.now !== undefined ? { now: options.now } : {}),
  }
  // Cap the pre-auth body (webhook payloads are tiny) so a large POST can't
  // be buffered before the HMAC check.
  return new Hono().post('/webhooks', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const secret = options.platformWebhookSecret
    if (secret === undefined) {
      throw new WebhooksDisabledError(
        'Platform webhooks are not configured — set CLOUD_PLATFORM_WEBHOOK_SECRET.',
      )
    }
    // Raw body FIRST: the signature covers exact bytes, not re-serialized JSON.
    const rawBody = await c.req.text()
    const nowSeconds = Math.floor((options.now?.() ?? new Date()).getTime() / 1000)
    verifySignature(
      secret,
      c.req.header('x-vynel-timestamp'),
      c.req.header('x-vynel-signature'),
      rawBody,
      nowSeconds,
    )

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw new ValidationError('Webhook body is not valid JSON.')
    }
    // safeParse, not parse — a raw ZodError would escape onError as a 500
    // instead of the hub's `{code, message}` 400 envelope.
    const eventResult = PlatformWebhookSchema.safeParse(parsed)
    if (!eventResult.success) throw new ValidationError(formatZodIssues(eventResult.error))
    const event = eventResult.data

    // Exactly-once: a duplicate/replayed delivery of the same event id is
    // acknowledged without re-applying (a replayed upgrade-after-downgrade
    // can't take effect twice).
    const isFresh = await claimPlatformEvent(options.db, {
      eventId: event.id,
      type: event.type,
      platformUserId: event.platformUserId,
    })
    if (!isFresh) {
      options.logger.info({ eventId: event.id, type: event.type }, 'platform webhook duplicate — skipped')
      return c.json({ received: true, outcome: 'duplicate' })
    }

    const result = await applyPlatformEvent(
      options.db,
      {
        type: event.type,
        platformUserId: event.platformUserId,
        ...(event.email !== undefined ? { email: event.email } : {}),
        ...(event.displayName !== undefined ? { displayName: event.displayName } : {}),
        ...(event.tier !== undefined ? { tier: event.tier } : {}),
        ...(event.tierExpiresAt !== undefined ? { tierExpiresAt: event.tierExpiresAt } : {}),
      },
      linkDeps,
    )
    options.logger.info(
      { eventId: event.id, type: event.type, outcome: result.outcome },
      'platform webhook applied',
    )
    return c.json({ received: true, outcome: result.outcome })
  })
}
