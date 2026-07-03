// Unit tests for `mapAgentToLeafInput` — pure mapping; no DB. The agent row is
// cast from a minimal fixture (only the fields the mapper reads matter).

import { describe, expect, it } from 'vitest'
import type { AgentRow } from '@vynel/db/repositories/agents'
import { mapAgentToLeafInput } from './map-agent-to-leaf-input.js'

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    prompt: 'You are a researcher.',
    allowedTools: ['Read', 'Grep'],
    disallowedTools: ['Bash'],
    model: 'claude-opus-4-8',
    ...overrides,
  } as unknown as AgentRow
}

describe('mapAgentToLeafInput', () => {
  it('maps an agent row to a leaf input under the behavior-gate', () => {
    const input = mapAgentToLeafInput(makeAgent(), { workspacePath: '/ws', taskText: 'do it' })
    expect(input.workspacePath).toBe('/ws')
    expect(input.userMessageText).toBe('do it')
    // Always the behavior gate — the safety backstop cards irreversible tools
    // regardless of the agent's own permissionMode.
    expect(input.permissionMode).toBe('bypass-with-behavior-gate')
    expect(input.allowedToolNames).toEqual(['Read', 'Grep'])
    expect(input.deniedToolNames).toEqual(['Bash'])
    expect(input.systemPromptAppend).toBe('You are a researcher.')
    expect(input.model).toBe('claude-opus-4-8')
  })

  it('falls back to empty tool lists and omits model when the agent inherits', () => {
    const input = mapAgentToLeafInput(
      makeAgent({ allowedTools: null, disallowedTools: null, model: null }),
      { workspacePath: '/ws', taskText: 't' },
    )
    expect(input.allowedToolNames).toEqual([])
    expect(input.deniedToolNames).toEqual([])
    expect(input.model).toBeUndefined()
  })

  it('lets an explicit model override the agent model', () => {
    const input = mapAgentToLeafInput(makeAgent(), {
      workspacePath: '/ws',
      taskText: 't',
      model: 'claude-haiku-4-5-20251001',
    })
    expect(input.model).toBe('claude-haiku-4-5-20251001')
  })
})
