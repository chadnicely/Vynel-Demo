import { describe, it, expect } from 'vitest'
import type { McpFeatureDescriptor, SessionToolContext } from '@vynel/mcp-contract'
import { composeSessionMcpServers } from './compose-session-mcp-servers.js'

const context: SessionToolContext = {
  db: {} as unknown,
  userId: 'user-1',
  workspaceId: 'ws-1',
  appRequest: () => new Response('{}', { status: 200 }),
}

// A fake feature descriptor — the composer is a pure function over the descriptor
// contract, so we exercise it without pulling the real (SDK-backed) vynel server.
function fakeDescriptor(overrides: Partial<McpFeatureDescriptor> = {}): McpFeatureDescriptor {
  return {
    serverName: 'vynel',
    build: () => ({ built: true }) as unknown as ReturnType<McpFeatureDescriptor['build']>,
    mutatingToolNames: [],
    ...overrides,
  }
}

describe('composeSessionMcpServers', () => {
  it('collects each descriptor into mcpServers + an allow pattern per server', () => {
    const composed = composeSessionMcpServers([fakeDescriptor()], context)
    expect(composed.mcpServers).toHaveProperty('vynel')
    expect(composed.allowedMcpToolPatterns).toEqual(['mcp__vynel__*'])
  })

  it('skips a descriptor whose build() returns null or isApplicable is false', () => {
    const nullBuild = fakeDescriptor({ serverName: 'a', build: () => null })
    const notApplicable = fakeDescriptor({ serverName: 'b', isApplicable: () => false })
    const composed = composeSessionMcpServers([nullBuild, notApplicable], context)
    expect(Object.keys(composed.mcpServers)).toEqual([])
    expect(composed.allowedMcpToolPatterns).toEqual([])
  })

  it('denies a capability-gated tool only when its capability is absent', () => {
    const descriptor = fakeDescriptor({
      capabilityGatedTools: { knowledge: ['mcp__vynel__search_knowledge'] },
    })
    const denied = composeSessionMcpServers([descriptor], context)
    expect(denied.deniedMcpToolPatterns).toEqual(['mcp__vynel__search_knowledge'])

    const allowed = composeSessionMcpServers([descriptor], context, {
      enabledCapabilityIds: new Set(['knowledge']),
    })
    expect(allowed.deniedMcpToolPatterns).toEqual([])
  })

  it('unions mutating tool names but never for an alwaysOn feature', () => {
    const mutating = fakeDescriptor({ mutatingToolNames: ['mcp__vynel__x'] })
    expect(composeSessionMcpServers([mutating], context).mutatingToolNames).toEqual([
      'mcp__vynel__x',
    ])

    const alwaysOn = fakeDescriptor({ alwaysOn: true, mutatingToolNames: ['mcp__vynel__x'] })
    expect(composeSessionMcpServers([alwaysOn], context).mutatingToolNames).toEqual([])
  })

  it('concatenates feature prompt contributions', () => {
    const withPrompt = fakeDescriptor({ contributePrompt: () => 'desktop guide' })
    expect(composeSessionMcpServers([withPrompt], context).systemPromptAppend).toBe('desktop guide')
  })
})
