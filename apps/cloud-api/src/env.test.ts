// The path-resolution rule: relative CLOUD_ARTIFACT_DIR /
// CLOUD_UPSTREAM_MANIFEST_PATH values (including the defaults) resolve
// against the REPO ROOT, never the process cwd — turbo runs the hub with
// cwd = apps/cloud-api, and a cwd-relative default silently pointed the
// import button and the upstream-watch cron at files that don't exist there.

import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { EnvSchema } from './env.js'

const FAKE_PEM_B64 = Buffer.from('-----BEGIN PRIVATE KEY-----\nfake\n', 'utf8').toString('base64')

function minimalEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    CLOUD_DATABASE_URL: 'postgres://localhost/test',
    CLOUD_ACCESS_TOKEN_PRIVATE_KEY: FAKE_PEM_B64,
    CLOUD_ACCESS_TOKEN_PUBLIC_KEY: FAKE_PEM_B64,
    CLOUD_ADMIN_TOKEN: 'a'.repeat(32),
    CLOUD_PUBLIC_BASE_URL: 'https://hub.test',
    ...overrides,
  }
}

describe('cloud env path resolution', () => {
  it('resolves the default artifact dir and manifest path against the repo root', () => {
    const env = EnvSchema.parse(minimalEnv())
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    expect(env.CLOUD_ARTIFACT_DIR).toBe(resolve(repoRoot, '.data/cloud-artifacts'))
    expect(env.CLOUD_UPSTREAM_MANIFEST_PATH).toBe(
      resolve(repoRoot, 'scripts/anthropic-catalog/manifest.json'),
    )
    // Never cwd-relative: the resolved paths are absolute regardless of
    // where the process started.
    expect(env.CLOUD_ARTIFACT_DIR.startsWith(sep) || /^[A-Za-z]:/.test(env.CLOUD_ARTIFACT_DIR)).toBe(true)
  })

  it('leaves absolute values (a deploy pointing at a volume) untouched', () => {
    const volume = resolve(sep, 'srv', 'vynel-artifacts')
    const env = EnvSchema.parse(minimalEnv({ CLOUD_ARTIFACT_DIR: volume }))
    expect(env.CLOUD_ARTIFACT_DIR).toBe(volume)
  })
})
