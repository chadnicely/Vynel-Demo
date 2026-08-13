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
import { resolveEngineUrl } from '@vynel/contracts/network/port-file'
import {
  parseVynelPortBase,
  resolveVynelPorts,
  type VynelPorts,
} from '@vynel/contracts/network/ports'

function buildEnvSchema(ports: VynelPorts) {
  return z.object({
    // 127.0.0.1 literal, never `localhost` — same IPv6-first hazard as the CLI:
    // the engine binds IPv4 loopback only.
    VYNEL_API_URL: z.string().url().default(`http://127.0.0.1:${ports.engine}`),
  })
}

// Canonical-band schema — the shape (and type) every consumer sees; loadEnv
// parses with the instance's actual band (`VYNEL_PORT_BASE`).
export const EnvSchema = buildEnvSchema(resolveVynelPorts())

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  const ports = resolveVynelPorts(parseVynelPortBase(process.env['VYNEL_PORT_BASE']))
  const env = buildEnvSchema(ports).parse(process.env)
  // No explicit URL → prefer the port a LIVE engine advertises (the desktop
  // shell may have allocated a non-default one), then the band default.
  const explicitUrl = process.env['VYNEL_API_URL'] === undefined ? undefined : env.VYNEL_API_URL
  env.VYNEL_API_URL = resolveEngineUrl(explicitUrl, ports.engine)
  return env
}
