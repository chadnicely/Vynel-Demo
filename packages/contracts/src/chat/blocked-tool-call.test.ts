import { describe, expect, it } from 'vitest'
import {
  BLOCKED_BY_PROVIDER_FALLBACK,
  buildBlockedToolOutput,
  readBlockedToolOutput,
  reauthorizeToolCallMessage,
} from './blocked-tool-call.js'

describe('buildBlockedToolOutput', () => {
  it('names the deciding component, falling back to the generic provider label', () => {
    expect(
      buildBlockedToolOutput({ reasonType: 'classifier', reason: 'irreversible', message: 'STOP' }),
    ).toEqual({ blockedBy: 'classifier', reason: 'irreversible', message: 'STOP' })
    expect(buildBlockedToolOutput({ reasonType: null, reason: null, message: 'STOP' })).toEqual({
      blockedBy: BLOCKED_BY_PROVIDER_FALLBACK,
      reason: null,
      message: 'STOP',
    })
  })
})

describe('readBlockedToolOutput', () => {
  it('round-trips the payload the consumer wrote', () => {
    const payload = buildBlockedToolOutput({
      reasonType: 'classifier',
      reason: 'no clear user intent',
      message: 'The user doesn’t want to take this action right now.',
    })
    expect(readBlockedToolOutput(payload)).toEqual(payload)
  })

  it('reads an empty reason as none', () => {
    expect(readBlockedToolOutput({ blockedBy: 'rule', reason: '', message: 'denied' })).toEqual({
      blockedBy: 'rule',
      reason: null,
      message: 'denied',
    })
  })

  it('is null for anything that is not the blocked payload', () => {
    for (const toolOutput of [
      null,
      undefined,
      'too destructive',
      { hits: 3 },
      [{ type: 'text', text: 'ok' }],
      { blockedBy: 'classifier' },
    ]) {
      expect(readBlockedToolOutput(toolOutput)).toBeNull()
    }
  })
})

describe('reauthorizeToolCallMessage', () => {
  it('spells the intent out with the raw tool name the model knows', () => {
    expect(reauthorizeToolCallMessage('Bash')).toBe(
      'Approved — go ahead and run Bash exactly as proposed.',
    )
    expect(reauthorizeToolCallMessage('mcp__ssh__run_command')).toBe(
      'Approved — go ahead and run mcp__ssh__run_command exactly as proposed.',
    )
  })
})
