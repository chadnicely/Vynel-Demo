import { describe, it, expect } from 'vitest'
import { deriveIntentKind } from './derive-intent-kind.js'

describe('deriveIntentKind', () => {
  it('classifies slash commands as channel-command', () => {
    expect(deriveIntentKind('/help')).toBe('channel-command')
    expect(deriveIntentKind('  /status now')).toBe('channel-command')
  })

  it('classifies button callback payloads as approval-reply', () => {
    expect(deriveIntentKind('approval:approve:abc123')).toBe('approval-reply')
  })

  it('classifies typed approve/deny as approval-reply', () => {
    expect(deriveIntentKind('approve')).toBe('approval-reply')
    expect(deriveIntentKind('Deny too risky')).toBe('approval-reply')
  })

  it('classifies everything else as chat-turn', () => {
    expect(deriveIntentKind('what did the supplier email about?')).toBe('chat-turn')
    expect(deriveIntentKind('approver list please')).toBe('chat-turn') // not a bare approve/deny
  })
})
