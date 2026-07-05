// Unit tests for `listProvidersWithStatus` — fakes only. The registry-default
// path is deliberately NOT exercised: it would call the real Claude provider's
// `getAuthenticationStatus`, which reads the host machine's actual install +
// auth state (env-dependent). The default expression itself is one registry
// call already covered by `registry.test.ts`.

import { describe, it, expect } from 'vitest'
import type { AuthenticationStatus } from '../shared/authentication-status.js'
import { makeFakeAiAgentProvider } from '../test-support/fake-ai-agent-provider.js'
import { listProvidersWithStatus } from './list-providers-with-status.js'

const claudeStatus: AuthenticationStatus = {
  providerId: 'claude',
  isInstalled: true,
  isAuthenticated: true,
  authenticatedAccountLabel: 'test@example.com',
  authenticationMethod: 'oauth',
  inactiveReason: null,
}

const codexStatus: AuthenticationStatus = {
  providerId: 'codex',
  isInstalled: false,
  isAuthenticated: false,
  authenticatedAccountLabel: null,
  authenticationMethod: null,
  inactiveReason: 'Not installed',
}

describe('listProvidersWithStatus', () => {
  it('returns one status per given provider, in order', async () => {
    const claude = makeFakeAiAgentProvider({
      getAuthenticationStatus: async () => claudeStatus,
    })
    const codex = makeFakeAiAgentProvider({
      providerId: 'codex',
      getAuthenticationStatus: async () => codexStatus,
    })
    await expect(listProvidersWithStatus([claude, codex])).resolves.toEqual([
      claudeStatus,
      codexStatus,
    ])
  })

  it('returns an empty array for an empty provider set', async () => {
    await expect(listProvidersWithStatus([])).resolves.toEqual([])
  })
})
