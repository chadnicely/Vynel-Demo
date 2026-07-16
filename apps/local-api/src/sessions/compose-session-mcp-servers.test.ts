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

  it('skips the prompt of a descriptor whose gated tools are ALL capability-denied', () => {
    // The notebook shape: capabilityGatedTools + contributePrompt. Capability
    // OFF must silence the standing "call list_playbooks…" line too, or the
    // model is steered into denied tools.
    const notebookLike = fakeDescriptor({
      serverName: 'vynel-notebook',
      capabilityGatedTools: { notebook: ['mcp__vynel-notebook__list_playbooks'] },
      contributePrompt: () => 'call list_playbooks before multi-step work',
    })
    const denied = composeSessionMcpServers([notebookLike], context)
    expect(denied.systemPromptAppend).toBe('')
    // The server itself still attaches — only the tools are denied + the prompt dropped.
    expect(denied.mcpServers).toHaveProperty('vynel-notebook')

    const enabled = composeSessionMcpServers([notebookLike], context, {
      enabledCapabilityIds: new Set(['notebook']),
    })
    expect(enabled.systemPromptAppend).toBe('call list_playbooks before multi-step work')
  })

  it('a partially-enabled descriptor still contributes its prompt', () => {
    const partiallyGated = fakeDescriptor({
      capabilityGatedTools: {
        memory: ['mcp__vynel__search_memory'],
        knowledge: ['mcp__vynel__search_knowledge'],
      },
      contributePrompt: () => 'feature guide',
    })
    const composed = composeSessionMcpServers([partiallyGated], context, {
      enabledCapabilityIds: new Set(['memory']),
    })
    expect(composed.systemPromptAppend).toBe('feature guide')
    expect(composed.deniedMcpToolPatterns).toEqual(['mcp__vynel__search_knowledge'])
  })

  it('an ungated descriptor with a prompt contributes regardless of the capability set', () => {
    const ungated = fakeDescriptor({ contributePrompt: () => 'always here' })
    expect(composeSessionMcpServers([ungated], context).systemPromptAppend).toBe('always here')
  })

  it('passes the enabled-capability set into contributePrompt (multi-capability descriptor)', () => {
    // The vynel-workspace shape: one descriptor gating several capabilities.
    // The composer's own skip is all-or-nothing per descriptor, so a
    // per-capability prompt section (the tasks discipline) reads the set
    // itself — the second contributePrompt argument.
    const vynelLike = fakeDescriptor({
      capabilityGatedTools: {
        memory: ['mcp__vynel__search_memory'],
        tasks: ['mcp__vynel__create_task'],
      },
      contributePrompt: (_context, enabledCapabilityIds) =>
        enabledCapabilityIds?.has('tasks') === true ? 'keep the task list current' : null,
    })

    const tasksOff = composeSessionMcpServers([vynelLike], context, {
      enabledCapabilityIds: new Set(['memory']),
    })
    expect(tasksOff.systemPromptAppend).toBe('')
    expect(tasksOff.deniedMcpToolPatterns).toEqual(['mcp__vynel__create_task'])

    const tasksOn = composeSessionMcpServers([vynelLike], context, {
      enabledCapabilityIds: new Set(['memory', 'tasks']),
    })
    expect(tasksOn.systemPromptAppend).toBe('keep the task list current')
    expect(tasksOn.deniedMcpToolPatterns).toEqual([])
  })
})
