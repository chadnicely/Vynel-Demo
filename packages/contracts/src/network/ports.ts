// THE home of Vynel's ports. The band is ONE base + fixed offsets: change a
// port here and every TypeScript consumer follows (env defaults, derived
// URLs, the remote engine's env, the tunnel). `VYNEL_PORT_BASE` in an
// instance's `.env` shifts the WHOLE band coherently — how a second checkout
// (a worktree) runs beside the first without a single collision.
//
// Two copies live outside TypeScript's reach — `apps/desktop/src-tauri/src/
// daemon.rs` and `tauri.conf.json` — and `scripts/src/generators/
// check-port-parity.ts` (wired into `pnpm test:parity`) fails the gate if
// they ever drift from the canonical constants below.

import { z } from 'zod'

export const VYNEL_PORT_BASE_DEFAULT = 18890

export const VYNEL_PORT_OFFSETS = {
  cloudApi: 0,
  cloudAdminWeb: 1,
  engine: 2,
  voiceDaemon: 3,
  localWeb: 4,
} as const

export interface VynelPorts {
  /** The hosted hub api (apps/cloud-api). */
  cloudApi: number
  /** The hub admin portal's dev server (apps/cloud-admin-web). */
  cloudAdminWeb: number
  /** The engine daemon (apps/local-api) — local desktop, remote server, and
   *  the tunnel's local end all use the SAME number, so switching modes never
   *  re-plumbs a URL anywhere. */
  engine: number
  /** The voice daemon's loopback overlay channel (apps/voice). */
  voiceDaemon: number
  /** The local web UI's dev server (apps/local-web). */
  localWeb: number
}

const highestOffset = Math.max(...Object.values(VYNEL_PORT_OFFSETS))

const portBaseSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535 - highestOffset)
  .default(VYNEL_PORT_BASE_DEFAULT)

/** Parse a raw `VYNEL_PORT_BASE` env value (unset/empty = the canonical
 *  band). Throws an actionable ZodError on garbage so a bad `.env` fails at
 *  boot, not at connect time. */
export function parseVynelPortBase(raw: string | undefined): number {
  return portBaseSchema.parse(raw === '' ? undefined : raw)
}

/** Derive the whole port band from one base. Every env default and derived
 *  URL flows through here — never from a bare constant. */
export function resolveVynelPorts(portBase: number = VYNEL_PORT_BASE_DEFAULT): VynelPorts {
  return {
    cloudApi: portBase + VYNEL_PORT_OFFSETS.cloudApi,
    cloudAdminWeb: portBase + VYNEL_PORT_OFFSETS.cloudAdminWeb,
    engine: portBase + VYNEL_PORT_OFFSETS.engine,
    voiceDaemon: portBase + VYNEL_PORT_OFFSETS.voiceDaemon,
    localWeb: portBase + VYNEL_PORT_OFFSETS.localWeb,
  }
}

// The canonical band, kept as LITERALS on purpose: they're the greppable
// anchors the parity check pins the Rust/Tauri copies against, and
// `ports.test.ts` pins them to `resolveVynelPorts()` so they can never drift
// from the derivation either.
export const VYNEL_CLOUD_API_PORT = 18890
export const VYNEL_CLOUD_ADMIN_WEB_PORT = 18891
export const VYNEL_ENGINE_PORT = 18892
export const VYNEL_VOICE_DAEMON_PORT = 18893
export const VYNEL_LOCAL_WEB_PORT = 18894
