import { describe, it, expect } from 'vitest'
import { pickAckForRequest } from './ack-library.js'

const DEFAULTS = ['Let me check.', 'One moment.', 'Let me find out.', 'On it.']

describe('pickAckForRequest', () => {
  it('acks contextually for a schedule/reminder request', () => {
    expect(pickAckForRequest('remind me in 15 minutes about my meeting').toLowerCase()).toContain(
      'schedule',
    )
    expect(pickAckForRequest('what schedules do I have').toLowerCase()).toContain('schedule')
  })

  it('acks contextually for a workspace request', () => {
    expect(pickAckForRequest('how many workspaces do I have').toLowerCase()).toContain('workspace')
  })

  it('acks contextually for a memory request', () => {
    expect(pickAckForRequest('what do you remember about my preferences').toLowerCase()).toMatch(
      /memory|looking/,
    )
  })

  it('acks "working on it" for a build/create request', () => {
    expect(pickAckForRequest('build me a landing page').toLowerCase()).toMatch(/started|working/)
  })

  it('falls back to a neutral ack when no intent matches', () => {
    expect(DEFAULTS).toContain(pickAckForRequest("what's the weather in Tokyo"))
  })

  it('is deterministic for a given transcript', () => {
    const request = 'how many workspaces do I have'
    expect(pickAckForRequest(request)).toBe(pickAckForRequest(request))
  })
})
