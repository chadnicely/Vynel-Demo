// Zod-validated env for `apps/cloud-api` — the SINGLE place `process.env` is
// touched in this app. The hub is a HOSTED service (Chad's servers, Docker):
// unlike the loopback-only local-api, it binds 0.0.0.0 behind the reverse
// proxy and everything secret arrives via env.
//
// Key material: Ed25519 PEMs are multiline — awkward in .env files — so both
// keys arrive BASE64-ENCODED (of the full PEM text). Generate a pair with
// `pnpm cloud:generate-keys`.

import { z } from 'zod'

const base64Pem = z
  .string()
  .min(1)
  .transform((raw, ctx) => {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    if (!decoded.includes('-----BEGIN')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expected a base64-encoded PEM (run `pnpm cloud:generate-keys`)',
      })
      return z.NEVER
    }
    return decoded
  })

export const EnvSchema = z.object({
  CLOUD_PORT: z.coerce.number().int().positive().default(8890),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Pooled URL for the app; the DIRECT (non-pooled) URL for the boot
  // migrator (postgres-phase2.md §1). With no pooler they're the same —
  // DIRECT defaults to the pooled value.
  CLOUD_DATABASE_URL: z.string().min(1),
  CLOUD_DIRECT_DATABASE_URL: z.string().min(1).optional(),
  CLOUD_ACCESS_TOKEN_PRIVATE_KEY: base64Pem,
  CLOUD_ACCESS_TOKEN_PUBLIC_KEY: base64Pem,
  CLOUD_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // The `kid` stamped on signed tokens — bump when rotating the keypair so
  // pinned clients can overlap two keys without a breaking change.
  CLOUD_TOKEN_KEY_ID: z.string().min(1).default('hub-1'),
  CLOUD_ENTITLEMENT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),
  // HMAC secret shared with Chad's platform for /platform/webhooks. OPTIONAL:
  // unset = the webhook surface answers 503 (admin provisioning still works).
  CLOUD_PLATFORM_WEBHOOK_SECRET: z.string().min(32).optional(),
  // Bearer for the /admin fallback surface (manual provisioning). Long and
  // random; the platform webhook auth (M3) is separate.
  CLOUD_ADMIN_TOKEN: z.string().min(32),
  // Where set-password links point (the hub's public origin). REQUIRED — a
  // default would mean a prod deploy that forgets it emails localhost links.
  CLOUD_PUBLIC_BASE_URL: z.string().url(),
})

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

export function loadEnv(): Env {
  cachedEnv ??= EnvSchema.parse(process.env)
  return cachedEnv
}
