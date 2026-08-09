// Zod-validated env for the CLI — the single place `process.env` is read
// (per the coding standard). `VYNEL_API_URL` is the base URL the SDK
// client targets; it defaults to the local api dev port.

import { z } from 'zod'
import { VYNEL_ENGINE_PORT } from '@vynel/contracts/network/ports'

export const EnvSchema = z.object({
  // 127.0.0.1 literal, never `localhost`: the engine binds IPv4 loopback
  // only, and Node's fetch may resolve localhost to ::1 first → ECONNREFUSED
  // ("fetch failed") on perfectly healthy installs.
  VYNEL_API_URL: z.string().url().default(`http://127.0.0.1:${VYNEL_ENGINE_PORT}`),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  return EnvSchema.parse(process.env)
}
