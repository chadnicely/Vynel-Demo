// Resolves the linux engine payload the server-install routes provision with.
// Dev seam: VYNEL_SERVER_PAYLOAD_ARCHIVE points at a `release:pack` tar.gz
// whose `.sha256` sidecar sits beside it; the target CPU rides the file name
// (vynel-engine-linux-<cpu>-<version>.tar.gz). Phase D5 replaces this with a
// release download keyed by the shell's version. Absent/invalid = null — the
// routes refuse with an actionable 409 rather than provisioning garbage.

import { existsSync, readFileSync } from 'node:fs'
import type { PayloadArchive } from '@vynel/server-install'
import type { Logger } from 'pino'

export function resolveServerPayloadArchive(
  archivePath: string | undefined,
  logger: Logger,
): PayloadArchive | null {
  if (archivePath === undefined) return null
  if (!existsSync(archivePath)) {
    logger.warn({ archivePath }, 'server payload archive not found — server installs disabled')
    return null
  }
  const sidecarPath = `${archivePath}.sha256`
  if (!existsSync(sidecarPath)) {
    logger.warn({ sidecarPath }, 'server payload archive has no .sha256 sidecar — server installs disabled')
    return null
  }
  const sha256 = readFileSync(sidecarPath, 'utf8').trim().split(/\s+/)[0] ?? ''
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    logger.warn({ sidecarPath }, 'server payload .sha256 sidecar is malformed — server installs disabled')
    return null
  }
  const cpu = archivePath.includes('arm64') ? 'arm64' : 'x64'
  return { path: archivePath, sha256, cpu }
}
