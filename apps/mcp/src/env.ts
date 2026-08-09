// Zod-validated env for the external MCP adapter — the single place
// `process.env` is read (per the coding standard). `VYNEL_API_URL` is the
// base URL the tool handlers dispatch to; it defaults to the local api dev
// port. Named to match the CLI (`apps/cli/src/env.ts`) — and NOT a bare
// `API_URL`, which an MCP host's environment might already define.
//
// stdio-only: there is no PORT (the transport is stdin/stdout). Phase-1
// single-user — the api's user-resolver resolves the local user server-side;
// a Phase-2 bearer relay would add `VYNEL_API_TOKEN` here.

import { z } from 'zod'
import { VYNEL_ENGINE_PORT } from '@vynel/contracts/network/ports'

export const EnvSchema = z.object({
  // 127.0.0.1 literal, never `localhost` — same IPv6-first hazard as the CLI:
  // the engine binds IPv4 loopback only.
  VYNEL_API_URL: z.string().url().default(`http://127.0.0.1:${VYNEL_ENGINE_PORT}`),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  return EnvSchema.parse(process.env)
}
