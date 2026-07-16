import { describe, it, expect } from 'vitest'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { buildInProcessMcpServer } from './build-in-process-server.js'
import { vynelWorkspaceDescriptor } from './vynel-mcp-feature-descriptor.js'

// A minimal SessionToolContext. Building the `vynel` server only CONSTRUCTS the
// tool objects (handlers close over scope + appRequest); it never queries the DB
// or dispatches a request until a tool is actually invoked — so stubs suffice.
function fakeContext(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    db: {} as unknown,
    userId: 'user-1',
    workspaceId: 'ws-1',
    appRequest: () => new Response('{}', { status: 200 }),
    ...overrides,
  }
}

describe('buildInProcessMcpServer', () => {
  it('builds a non-empty vynel MCP server from the generated registry', () => {
    const server = buildInProcessMcpServer(
      { db: {} as never, userId: 'user-1', workspaceId: 'ws-1' },
      () => new Response('{}', { status: 200 }),
    )
    // Building must not throw (proves the generated registry is non-empty and
    // every factory constructs) and yields an SDK server config object.
    expect(server).toBeDefined()
    expect(typeof server).toBe('object')
  })
})

describe('vynelWorkspaceDescriptor', () => {
  it('is a well-formed McpFeatureDescriptor for the vynel server', () => {
    expect(vynelWorkspaceDescriptor.serverName).toBe('vynel')
    // KLONE's mutating vynel tools are auto-approved (x-mcp mutatingApproved), so
    // nothing cards under bypass yet.
    expect(vynelWorkspaceDescriptor.mutatingToolNames).toEqual([])
    // `knowledge` and `memory` each gate their whole toolset (capability OFF →
    // none of its tools); the gate names use the mcp__vynel__ prefix.
    // test: correct expectation for memory gating — memory grew 6 MCP tools in
    // the 2026-07-11 tags round, so it now gates like knowledge (was: no entry).
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.knowledge).toContain(
      'mcp__vynel__search_knowledge',
    )
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.memory).toEqual([
      'mcp__vynel__list_memory_entries',
      'mcp__vynel__search_memory',
      'mcp__vynel__list_memory_tags',
      'mcp__vynel__create_memory_entry',
      'mcp__vynel__update_memory_entry',
      'mcp__vynel__add_memory_from_file',
    ])
    // `tasks` gates all five task tools (tasks module, 2026-07-17). The exact
    // list is pinned so a typo'd gate name can't silently leave a tool ungated
    // (the composer spec-tests the mechanism with fakes only).
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.tasks).toEqual([
      'mcp__vynel__list_tasks',
      'mcp__vynel__create_task',
      'mcp__vynel__update_task',
      'mcp__vynel__complete_task',
      'mcp__vynel__list_my_tasks',
    ])
  })

  it('contributes the task discipline ONLY when the tasks capability is enabled', () => {
    const context = fakeContext()
    const withTasks = vynelWorkspaceDescriptor.contributePrompt?.(context, new Set(['tasks']))
    expect(withTasks).toContain('list_tasks')
    expect(withTasks).toContain('complete_task')
    // Tasks off (other capabilities on) → no standing line steering the model
    // into denied tools. An undefined set (no capability info) also drops it.
    expect(vynelWorkspaceDescriptor.contributePrompt?.(context, new Set(['memory']))).toBeNull()
    expect(vynelWorkspaceDescriptor.contributePrompt?.(context)).toBeNull()
  })

  it('build() returns a live server for a workspace context', () => {
    const server = vynelWorkspaceDescriptor.build(fakeContext())
    expect(server).not.toBeNull()
    expect(typeof server).toBe('object')
  })
})
