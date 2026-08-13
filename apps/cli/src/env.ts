// Zod-validated env for the CLI — the single place `process.env` is read
// (per the coding standard). `VYNEL_API_URL` is the base URL the SDK
// client targets; it defaults to the local api dev port.

import { z } from 'zod'
import { resolveEngineUrl } from '@vynel/contracts/network/port-file'
import {
  parseVynelPortBase,
  resolveVynelPorts,
  type VynelPorts,
} from '@vynel/contracts/network/ports'

function buildEnvSchema(ports: VynelPorts) {
  return z.object({
    // 127.0.0.1 literal, never `localhost`: the engine binds IPv4 loopback
    // only, and Node's fetch may resolve localhost to ::1 first → ECONNREFUSED
    // ("fetch failed") on perfectly healthy installs.
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
