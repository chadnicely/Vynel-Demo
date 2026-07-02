// Zod-validated env for the CLI — the single place `process.env` is read
// (per the coding standard). `VYNEL_API_URL` is the base URL the SDK
// client targets; it defaults to the local api dev port.

import { z } from 'zod'

export const EnvSchema = z.object({
  VYNEL_API_URL: z.string().url().default('http://localhost:8998'),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  return EnvSchema.parse(process.env)
}
