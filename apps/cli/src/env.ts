// Zod-validated env for the CLI — the single place `process.env` is read
// (per the coding standard). `VYNEL_API_URL` is the base URL the SDK
// client targets; it defaults to the local api dev port.

import { z } from 'zod'
import { VYNEL_ENGINE_PORT } from '@vynel/contracts/network/ports'

export const EnvSchema = z.object({
  VYNEL_API_URL: z.string().url().default(`http://localhost:${VYNEL_ENGINE_PORT}`),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  return EnvSchema.parse(process.env)
}
