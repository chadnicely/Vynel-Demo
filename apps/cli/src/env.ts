// Zod-validated env for the CLI — the single place `process.env` is read
// (per the coding standard). `VYNEL_API_URL` is the base URL the SDK
// client targets; it defaults to the local api dev port.

import { z } from 'zod'
import {
  defaultUserDataDir,
  enginePortFilePath,
  resolveEngineUrl,
} from '@vynel/contracts/network/port-file'
import {
  VYNEL_PORT_BASE_DEFAULT,
  parseVynelPortBase,
  resolveVynelPorts,
} from '@vynel/contracts/network/ports'

function buildEnvSchema(portBase: number) {
  const ports = resolveVynelPorts(portBase)
  return z.object({
    VYNEL_PORT_BASE: z.coerce.number().int().positive().default(portBase),
    // Where the engine advertises its port file — must mirror the engine's
    // own VYNEL_USER_DATA_DIR or discovery silently misses it.
    VYNEL_USER_DATA_DIR: z.string().optional(),
    // 127.0.0.1 literal, never `localhost`: the engine binds IPv4 loopback
    // only, and Node's fetch may resolve localhost to ::1 first → ECONNREFUSED
    // ("fetch failed") on perfectly healthy installs.
    VYNEL_API_URL: z.string().url().default(`http://127.0.0.1:${ports.engine}`),
  })
}

// Canonical-band schema — the shape (and type) every consumer sees; loadEnv
// parses with the instance's actual band (`VYNEL_PORT_BASE`).
export const EnvSchema = buildEnvSchema(VYNEL_PORT_BASE_DEFAULT)

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  const portBase = parseVynelPortBase(process.env['VYNEL_PORT_BASE'])
  const env = buildEnvSchema(portBase).parse(process.env)
  // No explicit URL → prefer the port a LIVE engine of OUR band advertises
  // (the desktop shell may have allocated a non-default one), then the band
  // default.
  const explicitUrl = process.env['VYNEL_API_URL'] === undefined ? undefined : env.VYNEL_API_URL
  const portFilePath = enginePortFilePath(portBase, env.VYNEL_USER_DATA_DIR ?? defaultUserDataDir())
  env.VYNEL_API_URL = resolveEngineUrl(explicitUrl, resolveVynelPorts(portBase).engine, portFilePath)
  return env
}
