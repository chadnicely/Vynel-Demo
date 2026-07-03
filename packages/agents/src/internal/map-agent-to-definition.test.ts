// Pure unit test for the row → SDK AgentDefinition mapper. No DB — the
// mapper is pure. Verifies the exactOptionalPropertyTypes-safe
// conditional assignment: null columns are OMITTED (not set to
// undefined), present columns are mapped.

import { describe, expect, it } from 'vitest'
import type { AgentRow } from '@vynel/db/repositories/agents'
import { mapAgentToDefinition } from './map-agent-to-definition.js'

function makeRow(overrides: Partial<AgentRow> = {}): AgentRow {
  const now = new Date()
  return {
    id: 'a1',
    userId: 'u1',
    workspaceId: null,
    slug: 'researcher',
    name: 'Researcher',
    description: 'Researches topics.',
    icon: null,
    prompt: 'You research.',
    model: null,
    effort: null,
    permissionMode: null,
    background: false,
    allowedTools: null,
    disallowedTools: null,
    scope: 'user',
    source: 'vynel',
    trustTier: 'verified',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

describe('mapAgentToDefinition', () => {
  it('maps only the required fields when every optional column is null', () => {
    const definition = mapAgentToDefinition(makeRow(), [])
    expect(definition).toEqual({
      description: 'Researches topics.',
      prompt: 'You research.',
    })
  })

  it('includes each optional field when present', () => {
    const definition = mapAgentToDefinition(
      makeRow({
        allowedTools: ['Read', 'Grep'],
        disallowedTools: ['Bash'],
        model: 'sonnet',
        effort: 'high',
        permissionMode: 'default',
        background: true,
      }),
      ['email-drafter'],
    )
    expect(definition).toEqual({
      description: 'Researches topics.',
      prompt: 'You research.',
      tools: ['Read', 'Grep'],
      disallowedTools: ['Bash'],
      model: 'sonnet',
      effort: 'high',
      permissionMode: 'default',
      skills: ['email-drafter'],
      background: true,
    })
  })

  it('omits background when false and skills when empty', () => {
    const definition = mapAgentToDefinition(makeRow({ background: false }), [])
    expect(definition).not.toHaveProperty('background')
    expect(definition).not.toHaveProperty('skills')
  })
})
