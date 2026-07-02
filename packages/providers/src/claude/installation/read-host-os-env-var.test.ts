// Tests for `readHostOsEnvVar` — the host-OS env-var carve-out helper.
// See `docs/blueprints/providers/blueprint.md §11.1`.

import { describe, expect, it, afterEach } from 'vitest'
import { readHostOsEnvVar } from './read-host-os-env-var.js'

const TEST_VAR = 'VYNEL_TEST_HOST_OS_ENV_VAR'

afterEach(() => {
  delete process.env[TEST_VAR]
})

describe('readHostOsEnvVar', () => {
  it('returns the value when the env var is set and non-empty', () => {
    process.env[TEST_VAR] = 'some-value'
    expect(readHostOsEnvVar(TEST_VAR)).toBe('some-value')
  })

  it('returns null when the env var is unset', () => {
    expect(readHostOsEnvVar(TEST_VAR)).toBeNull()
  })

  it('returns null when the env var is empty or whitespace-only', () => {
    process.env[TEST_VAR] = '   '
    expect(readHostOsEnvVar(TEST_VAR)).toBeNull()
  })
})
