// The /auth surface: parse → validate → call the accounts leaf → shape
// response. No business logic here — the flows live in @vynel/accounts.

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  confirmSetPassword,
  listDevices,
  requestPasswordReset,
  revokeDevice,
  rotateSession,
  signInWithPassword,
  signOut,
  type AuthenticatedSession,
} from '@vynel/accounts'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { requireAccount, type AccountVariables } from '../middleware/require-account.js'
import { createFixedWindowRateLimiter } from '../middleware/rate-limit.js'

const DeviceSchema = z.object({
  deviceName: z.string().min(1).max(120),
  devicePlatform: z.string().min(1).max(40),
  appVersion: z.string().min(1).max(40),
})

const SignInSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  device: DeviceSchema,
})

const RefreshTokenSchema = z.object({ refreshToken: z.string().min(1).max(200) })

const PasswordResetRequestSchema = z.object({ email: z.string().email().max(320) })

// Length-first password policy (NIST): no composition rules, just enough
// entropy room; the 200 cap bounds argon2 input.
const SetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
})

function toSessionResponse(session: AuthenticatedSession) {
  return {
    accountId: session.accountId,
    email: session.email,
    displayName: session.displayName,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshToken: session.refreshToken,
  }
}

export function buildAuthRoutes(options: CloudAppOptions) {
  const sessionDeps = {
    accessTokens: options.accessTokens,
    ...(options.now !== undefined ? { now: options.now } : {}),
  }
  const linkDeps = {
    mail: options.mail,
    linkBaseUrl: options.linkBaseUrl,
    ...(options.now !== undefined ? { now: options.now } : {}),
  }
  const now = options.now
  const nowMs = now !== undefined ? () => now().getTime() : Date.now
  const signInLimiter = createFixedWindowRateLimiter({
    limit: 5,
    windowMs: 5 * 60 * 1000,
    now: nowMs,
  })
  const resetLimiter = createFixedWindowRateLimiter({
    limit: 3,
    windowMs: 15 * 60 * 1000,
    now: nowMs,
  })

  return new Hono<{ Variables: AccountVariables }>()
    .post('/sign-in', zValidator('json', SignInSchema), async (c) => {
      const body = c.req.valid('json')
      signInLimiter.consume(body.email.toLowerCase())
      const session = await signInWithPassword(options.db, body, sessionDeps)
      return c.json(toSessionResponse(session))
    })
    .post('/refresh', zValidator('json', RefreshTokenSchema), async (c) => {
      const session = await rotateSession(options.db, c.req.valid('json'), sessionDeps)
      return c.json(toSessionResponse(session))
    })
    .post('/sign-out', zValidator('json', RefreshTokenSchema), async (c) => {
      await signOut(options.db, c.req.valid('json'))
      return c.json({ signedOut: true })
    })
    .post('/password-reset/request', zValidator('json', PasswordResetRequestSchema), (c) => {
      const body = c.req.valid('json')
      resetLimiter.consume(body.email.toLowerCase())
      // Fire WITHOUT awaiting and always 202: a known email would otherwise
      // answer hundreds of ms slower (token writes + the mail-provider call)
      // than an unknown one — a timing side channel on account existence.
      void requestPasswordReset(options.db, body, linkDeps).catch((error: unknown) => {
        options.logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'password-reset issuance failed',
        )
      })
      return c.json({ accepted: true }, 202)
    })
    .post('/set-password', zValidator('json', SetPasswordSchema), async (c) => {
      const { accountId } = await confirmSetPassword(options.db, c.req.valid('json'), sessionDeps)
      return c.json({ accountId })
    })
    .get('/devices', requireAccount(options.accessTokenVerifier), async (c) => {
      const devices = await listDevices(options.db, { accountId: c.var.account.accountId })
      return c.json({
        devices: devices.map((device) => ({
          ...device,
          lastUsedAt: device.lastUsedAt.toISOString(),
          expiresAt: device.expiresAt.toISOString(),
        })),
      })
    })
    .delete('/devices/:deviceId', requireAccount(options.accessTokenVerifier), async (c) => {
      await revokeDevice(options.db, {
        accountId: c.var.account.accountId,
        deviceId: c.req.param('deviceId'),
      })
      return c.json({ revoked: true })
    })
}
