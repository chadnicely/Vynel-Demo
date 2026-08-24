import { describe, it, expect } from 'vitest'
import { composeSessionInstruction } from './compose-session-instruction.js'
import { loadSessionInstruction } from './load-session-instruction.js'

describe('composeSessionInstruction', () => {
  it('stacks the text base before the kind file', () => {
    const composed = composeSessionInstruction('global-root')
    expect(composed).toBe(
      `${loadSessionInstruction('base')}\n\n${loadSessionInstruction('global-root')}`,
    )
  })

  it('a voice turn reads the voice base instead of the text base', () => {
    const composed = composeSessionInstruction('global-root', { voice: true })
    expect(composed).toBe(
      `${loadSessionInstruction('voice-base')}\n\n${loadSessionInstruction('global-root')}`,
    )
    // The text base's formatting rules must not leak onto a spoken turn.
    expect(composed).not.toContain(loadSessionInstruction('base'))
  })

  it('composes the manager and child kinds on the text base', () => {
    for (const kind of ['workspace-manager', 'spawned-session'] as const) {
      const composed = composeSessionInstruction(kind)
      expect(composed.startsWith(loadSessionInstruction('base')), kind).toBe(true)
      expect(composed.endsWith(loadSessionInstruction(kind)), kind).toBe(true)
    }
  })

  it('renders the agent-colleague kind with the agent name filled in', () => {
    const composed = composeSessionInstruction('agent-colleague', { agentName: 'Nova' })
    expect(composed).toContain('You are "Nova"')
    expect(composed).not.toContain('{{agentName}}')
    expect(composed.startsWith(loadSessionInstruction('base'))).toBe(true)
  })

  it('fails loudly when the agent-colleague placeholder is left unfilled', () => {
    expect(() => composeSessionInstruction('agent-colleague')).toThrow(/agentName/)
  })
})