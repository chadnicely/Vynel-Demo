// The spoken thread's tool rule (voice-realtime A1): a voice turn's streamed
// text IS its voice, so `speak` is denied on it — and ONLY on it.

import { describe, it, expect } from 'vitest'
import { ROUTING_TOOL_NAMES } from '@vynel/mcp/tool-gates'
import type { ComposedSessionMcpServers } from './compose-session-mcp-servers.js'
import {
  VOICE_THREAD_DENIED_TOOL_NAMES,
  withVoiceThreadToolDenials,
} from './voice-thread-tools.js'

function composed(
  overrides: Partial<ComposedSessionMcpServers> = {},
): ComposedSessionMcpServers {
  return {
    mcpServers: { vynel: {} },
    deniedMcpToolPatterns: [],
    mutatingToolNames: [],
    askModeApprovalToolNames: [],
    systemPromptAppend: '',
    ...overrides,
  }
}

describe('withVoiceThreadToolDenials', () => {
  it('denies the speak tool so the thread cannot say its answer twice', () => {
    expect(withVoiceThreadToolDenials(composed()).deniedMcpToolPatterns).toEqual([
      'mcp__vynel__speak',
    ])
  })

  it('is additive — the capability/tier denials the composer produced survive', () => {
    const gated = composed({ deniedMcpToolPatterns: ['mcp__vynel__search_knowledge'] })
    expect(withVoiceThreadToolDenials(gated).deniedMcpToolPatterns).toEqual([
      'mcp__vynel__search_knowledge',
      'mcp__vynel__speak',
    ])
  })

  it('is idempotent and leaves the rest of the attachment byte-for-byte', () => {
    const once = withVoiceThreadToolDenials(composed({ systemPromptAppend: 'rules' }))
    const twice = withVoiceThreadToolDenials(once)
    expect(twice).toBe(once)
    expect(twice.mcpServers).toEqual({ vynel: {} })
    expect(twice.systemPromptAppend).toBe('rules')
  })

  it('denies a tool the routing surface actually registers (drift guard)', () => {
    // If the route's `x-mcp` name is ever renamed, the generated inventory
    // moves and this deny would silently stop matching anything.
    for (const toolName of VOICE_THREAD_DENIED_TOOL_NAMES) {
      expect(ROUTING_TOOL_NAMES, toolName).toContain(toolName)
    }
  })

  it('denies ONLY speak — a voice request may still start, list and end a call', () => {
    expect([...VOICE_THREAD_DENIED_TOOL_NAMES]).toEqual(['mcp__vynel__speak'])
    const denied = withVoiceThreadToolDenials(composed()).deniedMcpToolPatterns
    for (const toolName of ['start_call', 'end_call', 'list_calls', 'send_task_to_workspace']) {
      expect(denied).not.toContain(`mcp__vynel__${toolName}`)
    }
  })
})
