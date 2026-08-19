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
    expect(prompt).toContain('send_task_to_workspace')
    expect(prompt).toContain('list_routing_channels')
    expect(prompt).toContain('send_to_channel')
    expect(prompt.toLowerCase()).toContain('route')
  })

  it('workspace-agent states the plain-language and approval operating rules', () => {
    const prompt = loadSessionInstruction('workspace-agent')
    expect(prompt).toContain('plain language')
    expect(prompt).toContain('approval card')
  })

  // test: correct expectation for the voice directive — was "reply by calling
  // `speak`", should be "your text IS the voice" (voice-realtime VR1: the tool
  // is no longer attached on a voice-thread turn, the client speaks the
  // streamed deltas).
  it('voice-turn teaches the spoken style and says the speak tool is gone', () => {
    const prompt = loadSessionInstruction('voice-turn')
    expect(prompt).toContain('VOICE')
    expect(prompt).toContain('HEARD as you write')
    expect(prompt).toContain('ONE or TWO short spoken sentences')
    expect(prompt).toContain('Lead with the answer')
    expect(prompt).toContain('No markdown')
    // The thread is long-lived and its transcript is full of the model's older
    // `speak` calls — the prompt must say the tool is gone, or a resumed turn
    // calls it and takes a disallowed-tool error mid-answer.
    expect(prompt).toContain('There is no `speak` tool')
    // ...and it must never read as an instruction to call it.
    expect(prompt).not.toMatch(/call(ing)? `?speak/i)
    // No canned acknowledgment lines anywhere (VR3) — the prompt names the
    // banned fillers so the model's own first sentence is the acknowledgment.
    expect(prompt).toContain('let me check')
    expect(prompt).toContain('one moment')
  })

  it('autopilot-marker tells the model it is on autopilot and names the needs_input exit', () => {
    const body = loadSessionInstruction('autopilot-marker')
    expect(body).toContain('AUTOPILOT')
    expect(body).toContain('needs_input')
  })

  // test: correct expectation for the per-message marker — same VR1 change as
  // the block above. It rides EVERY voice message, so it stays one line.
  it('voice-turn-marker re-states the spoken style (and the missing tool) in one line', () => {
    const marker = loadSessionInstruction('voice-turn-marker')
    expect(marker).toContain('VOICE')
    expect(marker).toContain('HEARD as you write')
    expect(marker).toContain('There is no `speak` tool')
    expect(marker).not.toMatch(/call(ing)? `?speak/i)
    expect(marker.trim().split('\n')).toHaveLength(1)
  })

  it('fails loudly for an id with no backing markdown file', () => {
    expect(() =>
      loadSessionInstruction('does-not-exist' as SessionInstructionId),
    ).toThrow(/could not be read/)
  })
})
