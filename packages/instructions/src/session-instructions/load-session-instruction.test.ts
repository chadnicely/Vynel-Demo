// Load-bearing guards for the always-on session instructions (migrated here from
// `@vynel/session`'s global-root-instructions.test.ts when the prompts became
// editable markdown). LLM-native routing only works if the global-root prompt
// names the routing tools — these fail loudly if an edit to the .md drops one.

import { describe, it, expect } from 'vitest'
import {
  loadSessionInstruction,
  type SessionInstructionId,
} from './load-session-instruction.js'

describe('loadSessionInstruction', () => {
  it('global-root names all four routing tools and frames the brain as a router', () => {
    const prompt = loadSessionInstruction('global-root')
    expect(prompt).toContain('list_routing_workspaces')
    expect(prompt).toContain('route_to_workspace')
    expect(prompt).toContain('list_routing_channels')
    expect(prompt).toContain('send_to_channel')
    expect(prompt.toLowerCase()).toContain('route')
  })

  it('workspace-agent states the plain-language and approval operating rules', () => {
    const prompt = loadSessionInstruction('workspace-agent')
    expect(prompt).toContain('plain language')
    expect(prompt).toContain('approval card')
  })

  it('voice-turn directs the model to reply through the speak tool', () => {
    expect(loadSessionInstruction('voice-turn')).toContain('speak')
  })

  it('fails loudly for an id with no backing markdown file', () => {
    expect(() =>
      loadSessionInstruction('does-not-exist' as SessionInstructionId),
    ).toThrow(/could not be read/)
  })
})
