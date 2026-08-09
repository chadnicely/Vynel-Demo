// The update-decision core in isolation: semver compare, the platform-key
// mapping, the 5-minute cache, and stale-while-error (a GitHub blip must
// serve the last good manifest, never break the update check).

import { describe, it, expect } from 'vitest'
import type { DesktopReleaseManifest } from '@vynel/contracts/hub/desktop-release'
import type { StructuralLogger } from '@vynel/logger'
import {
  compareSemverTriples,
  createDesktopReleaseSource,
  ReleaseManifestUnavailableError,
} from './desktop-release-manifest.js'

const WINDOWS_PLATFORM = {
  signature: 'minisign-sig-content',
  url: 'https://github.com/kafijunior/vynel-releases/releases/download/v0.2.0/Vynel_0.2.0_x64-setup.exe',
}

function manifest(version = '0.2.0'): DesktopReleaseManifest {
  return {
    version,
    pub_date: '2026-08-09T00:00:00.000Z',
    platforms: { 'windows-x86_64': WINDOWS_PLATFORM },
  }
}

function buildCapturingLogger(): StructuralLogger & { warns: string[] } {
  const warns: string[] = []
  return {
    warns,
    info: () => {},
    warn: (_payload, message) => warns.push(message ?? ''),
    error: () => {},
  }
}

/** A source with a counting fetcher and a controllable clock. */
function buildSource(over: {
  fetchManifest: () => Promise<DesktopReleaseManifest>
  logger?: StructuralLogger
}) {
  let nowMs = 1_000_000
  let fetchCount = 0
  const source = createDesktopReleaseSource({
    manifestUrl: 'https://releases.test/latest.json',
    logger: over.logger ?? buildCapturingLogger(),
    fetchManifest: async () => {
      fetchCount += 1
      return over.fetchManifest()
    },
    now: () => new Date(nowMs),
  })
  return {
    source,
    fetches: () => fetchCount,
    advanceMinutes: (minutes: number) => {
      nowMs += minutes * 60 * 1000
    },
  }
}

const WINDOWS_CHECK = { target: 'windows', arch: 'x86_64', currentVersion: '0.1.0' } as const

describe('compareSemverTriples', () => {
  it('orders numerically, not lexically', () => {
    expect(compareSemverTriples('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareSemverTriples('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareSemverTriples('0.2.0', '0.2.0')).toBe(0)
    expect(compareSemverTriples('0.2.0', '0.2.1')).toBeLessThan(0)
  })
})

describe('createDesktopReleaseSource', () => {
  it('resolves an update when the manifest is strictly newer', async () => {
    const { source } = buildSource({ fetchManifest: async () => manifest('0.2.0') })
    expect(await source.resolveUpdate(WINDOWS_CHECK)).toEqual({
      version: '0.2.0',
      pub_date: '2026-08-09T00:00:00.000Z',
      url: WINDOWS_PLATFORM.url,
      signature: WINDOWS_PLATFORM.signature,
    })
  })

  it('resolves null for an equal or newer installed version', async () => {
    const { source } = buildSource({ fetchManifest: async () => manifest('0.2.0') })
    expect(await source.resolveUpdate({ ...WINDOWS_CHECK, currentVersion: '0.2.0' })).toBeNull()
    expect(await source.resolveUpdate({ ...WINDOWS_CHECK, currentVersion: '0.3.0' })).toBeNull()
  })

  it('resolves null when the manifest has no entry for the platform', async () => {
    const { source } = buildSource({ fetchManifest: async () => manifest('0.2.0') })
    expect(
      await source.resolveUpdate({ target: 'linux', arch: 'aarch64', currentVersion: '0.1.0' }),
    ).toBeNull()
  })

  it('serves from cache within the TTL and refetches after it', async () => {
    const { source, fetches, advanceMinutes } = buildSource({
      fetchManifest: async () => manifest('0.2.0'),
    })
    await source.resolveUpdate(WINDOWS_CHECK)
    advanceMinutes(4)
    await source.resolveUpdate(WINDOWS_CHECK)
    expect(fetches()).toBe(1)

    advanceMinutes(2) // past the 5-minute TTL
    await source.resolveUpdate(WINDOWS_CHECK)
    expect(fetches()).toBe(2)
  })

  it('serves the cached copy and warns when a refresh fails', async () => {
    const logger = buildCapturingLogger()
    let failing = false
    const { source, advanceMinutes } = buildSource({
      logger,
      fetchManifest: async () => {
        if (failing) throw new Error('github is down')
        return manifest('0.2.0')
      },
    })
    await source.resolveUpdate(WINDOWS_CHECK)

    failing = true
    advanceMinutes(6)
    const update = await source.resolveUpdate(WINDOWS_CHECK)
    expect(update?.version).toBe('0.2.0')
    expect(logger.warns).toEqual([
      'desktop-release manifest refresh failed — serving cached copy',
    ])
  })

  it('throws a typed 502 when the first fetch fails with nothing cached', async () => {
    const { source } = buildSource({
      fetchManifest: async () => {
        throw new Error('github is down')
      },
    })
    await expect(source.resolveUpdate(WINDOWS_CHECK)).rejects.toBeInstanceOf(
      ReleaseManifestUnavailableError,
    )
  })
})
