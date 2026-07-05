// Unit tests for `getProviderAuthenticationStatus` — always passes a fake
// active provider on the happy path so the real Claude runtime's host state
// is never read at test time.

import { describe, it, expect } from 'vitest'
import { ValidationError } from '@vynel/errors'
import type { AuthenticationStatus } from '../shared/authentication-status.js'
import { makeFakeAiAgentProvider } from '../test-support/fake-ai-agent-provider.js'
import { getProviderAuthenticationStatus } from './get-provider-authentication-status.js'

const claudeStatus: AuthenticationStatus = {
  providerId: 'claude',
  isInstalled: true,
  isAuthenticated: false,
  authenticatedAccountLabel: null,
  authenticationMethod: null,
  inactiveReason: 'OAuth expired',
}

describe('getProviderAuthenticationStatus', () => {
  it("returns the active provider's status as data (not-authenticated is not an error)", async () => {
    const active = makeFakeAiAgentProvider({
      getAuthenticationStatus: async () => claudeStatus,
    })
    await expect(getProviderAuthenticationStatus('claude', active)).resolves.toEqual(claudeStatus)
  })

  it('throws ValidationError for an unregistered provider id', async () => {
    const active = makeFakeAiAgentProvider()
    await expect(getProviderAuthenticationStatus('gemini', active)).rejects.toThrow(
      ValidationError,
    )
  })
})
