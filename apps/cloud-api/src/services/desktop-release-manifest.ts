// The desktop-release update core: fetch the releases repo's latest.json,
// cache it, and decide whether an installed client should update. v1 proxies
// GitHub (no DB, no schema) — the endpoint's SHAPE is permanent, so channels
// or staged rollout later change only this module, never the clients.
//
// Cache: one manifest per source instance (server.ts creates exactly one at
// boot, so it is process-wide), refreshed at most every TTL. Stale-while-
// error: a failed refresh with a cached copy serves the cached copy and logs
// a warn — a GitHub blip must never break every installed app's update check.

import { z } from 'zod'
import { VynelError } from '@vynel/errors'
import type { StructuralLogger } from '@vynel/logger'
import type {
  DesktopReleaseManifest,
  DesktopUpdateArch,
  DesktopUpdateResponse,
  DesktopUpdateTarget,
} from '@vynel/contracts/hub/desktop-release'
import { formatZodIssues } from '../middleware/json-validator.js'

/** Releases are plain x.y.z (build-desktop.ts stamps the package version) —
 * anything else in the path or the manifest is rejected, not guessed at. */
export const SEMVER_TRIPLE_PATTERN = /^\d+\.\d+\.\d+$/

export class ReleaseManifestUnavailableError extends VynelError {
  readonly code = 'release_manifest_unavailable'
  readonly httpStatus = 502
}

const DesktopReleaseManifestSchema = z.object({
  version: z.string().regex(SEMVER_TRIPLE_PATTERN, 'expected a plain x.y.z version'),
  pub_date: z.string().min(1),
  platforms: z.record(z.object({ signature: z.string().min(1), url: z.string().url() })),
})

/** Standard numeric-triple compare: negative when a < b, 0 when equal,
 * positive when a > b. Enough for plain x.y.z — no prerelease tags here. */
export function compareSemverTriples(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0, aPatch = 0] = a.split('.').map(Number)
  const [bMajor = 0, bMinor = 0, bPatch = 0] = b.split('.').map(Number)
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch
}

export interface DesktopUpdateCheck {
  readonly target: DesktopUpdateTarget
  readonly arch: DesktopUpdateArch
  readonly currentVersion: string
}

export interface DesktopReleaseSource {
  /** The update the client should install, or null when it is up to date /
   * no release exists for its platform. */
  resolveUpdate(check: DesktopUpdateCheck): Promise<DesktopUpdateResponse | null>
}

async function fetchManifestFromUrl(manifestUrl: string): Promise<DesktopReleaseManifest> {
  const response = await fetch(manifestUrl, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`manifest fetch answered ${response.status} for ${manifestUrl}`)
  }
  const parsed = DesktopReleaseManifestSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error(`latest.json is not a valid release manifest — ${formatZodIssues(parsed.error)}`)
  }
  return parsed.data
}

export function createDesktopReleaseSource(options: {
  manifestUrl: string
  logger: StructuralLogger
  /** Test seam — defaults to fetching + validating `manifestUrl`. */
  fetchManifest?: () => Promise<DesktopReleaseManifest>
  cacheTtlMs?: number
  /** Test seam — cache freshness reads time through this. */
  now?: () => Date
}): DesktopReleaseSource {
  const fetchManifest = options.fetchManifest ?? (() => fetchManifestFromUrl(options.manifestUrl))
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000
  const now = options.now ?? (() => new Date())

  let cached: { manifest: DesktopReleaseManifest; fetchedAt: number } | null = null

  const latestManifest = async (): Promise<DesktopReleaseManifest> => {
    if (cached !== null && now().getTime() - cached.fetchedAt < cacheTtlMs) {
      return cached.manifest
    }
    try {
      cached = { manifest: await fetchManifest(), fetchedAt: now().getTime() }
      return cached.manifest
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (cached !== null) {
        options.logger.warn(
          { error: message, manifestUrl: options.manifestUrl },
          'desktop-release manifest refresh failed — serving cached copy',
        )
        return cached.manifest
      }
      throw new ReleaseManifestUnavailableError(
        `Could not fetch the desktop release manifest (${message}). ` +
          'Check the releases repo / CLOUD_RELEASES_MANIFEST_URL and retry.',
      )
    }
  }

  return {
    async resolveUpdate(check) {
      const manifest = await latestManifest()
      const platform = manifest.platforms[`${check.target}-${check.arch}`]
      if (platform === undefined) return null
      if (compareSemverTriples(manifest.version, check.currentVersion) <= 0) return null
      return {
        version: manifest.version,
        pub_date: manifest.pub_date,
        url: platform.url,
        signature: platform.signature,
      }
    },
  }
}
