// Unit tests for the internal provider selection: active instance preferred
// for its own id, registry fallback otherwise. No provider method is ever
// invoked here, so the registry's REAL Claude singleton is safe to touch —
// selection never interrogates the host machine.

import { describe, it, expect } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { resolveAiAgentProvider } from '../registry.js'
import { makeFakeAiAgentProvider } from '../test-support/fake-ai-agent-provider.js'
import { selectAiAgentProvider } from './select-ai-agent-provider.js'

describe('selectAiAgentProvider', () => {
  it('returns the active provider when it serves the requested id', () => {
    const active = makeFakeAiAgentProvider()
    expect(selectAiAgentProvider('claude', active)).toBe(active)
  })

  it('falls back to the registry singleton when no active provider is given', () => {
    expect(selectAiAgentProvider('claude')).toBe(resolveAiAgentProvider('claude'))
  })

  it('throws ValidationError for an unregistered id even with an active provider', () => {
    const active = makeFakeAiAgentProvider()
    expect(() => selectAiAgentProvider('codex', active)).toThrow(ValidationError)
  })
})
