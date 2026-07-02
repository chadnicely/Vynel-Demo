// Tests for the provider registry — singleton resolution + the unregistered-id
// error. See `docs/blueprints/providers/blueprint.md §17.1`.

import { describe, expect, it } from 'vitest'
import { ValidationError } from '@vynel/errors'
import {
  listAvailableAiAgentProviderIds,
  listAvailableAiAgentProviders,
  resolveAiAgentProvider,
} from './registry.js'

describe('provider registry', () => {
  it('resolves the claude provider and returns the same singleton each call', () => {
    const firstResolve = resolveAiAgentProvider('claude')
    const secondResolve = resolveAiAgentProvider('claude')
    expect(firstResolve.providerId).toBe('claude')
    expect(firstResolve).toBe(secondResolve)
  })

  it('throws ValidationError for a provider id that is not registered', () => {
    // `codex` is a valid AiAgentProviderId but not registered in Phase 1.
    expect(() => resolveAiAgentProvider('codex')).toThrow(ValidationError)
  })

  it('lists the registered providers (Phase 1: claude only)', () => {
    expect(listAvailableAiAgentProviderIds()).toEqual(['claude'])
    expect(listAvailableAiAgentProviders().map((provider) => provider.providerId)).toEqual([
      'claude',
    ])
  })
})
