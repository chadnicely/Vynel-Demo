import { describe, it, expect } from 'vitest'
import { deriveIntentKind } from './derive-intent-kind.js'

describe('deriveIntentKind', () => {
  it('classifies slash commands as channel-command in DMs', () => {
    expect(deriveIntentKind('/help')).toBe('channel-command')
    expect(deriveIntentKind('  /status now')).toBe('channel-command')
  })

  it('classifies a GROUP slash command as a chat turn (addressed speech, not a no-op)', () => {
    expect(deriveIntentKind('/ask@theris01bot can you see this group', 'group')).toBe('chat-turn')
    // Approval keywords keep their meaning in groups.
    expect(deriveIntentKind('approve', 'group')).toBe('approval-reply')
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
