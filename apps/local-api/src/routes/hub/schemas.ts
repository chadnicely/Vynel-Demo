// Zod schemas for the `/hub` surface. The response shapes mirror
// `@vynel/contracts/hub/hub-auth` (HubLinkStatus / HubDeviceView) — zod
// lives at the app parse boundary, the types are the shared contract.

import { z } from 'zod'

export const HubLinkStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-configured') }),
  z.object({ kind: z.literal('signed-out') }),
  z.object({
    kind: z.literal('signed-in'),
    email: z.string(),
    displayName: z.string(),
    checkedAt: z.string(),
  }),
  z.object({ kind: z.literal('locked'), message: z.string() }),
  z.object({
    kind: z.literal('offline'),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
  }),
])

export const HubSignInBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
})

export const HubDeviceSchema = z.object({
  id: z.string(),
  deviceName: z.string(),
  devicePlatform: z.string(),
  appVersion: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
})

export const HubDevicesResponseSchema = z.object({ devices: z.array(HubDeviceSchema) })

export const HubRevokeDeviceResponseSchema = z.object({ revoked: z.literal(true) })
