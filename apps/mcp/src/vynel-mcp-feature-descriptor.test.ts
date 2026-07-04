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
    // Only `knowledge` gates tools today (memory emits none); the gate names use
    // the mcp__vynel__ prefix.
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.knowledge).toContain(
      'mcp__vynel__search_knowledge',
    )
    expect(vynelWorkspaceDescriptor.capabilityGatedTools).not.toHaveProperty('memory')
  })

  it('build() returns a live server for a workspace context', () => {
    const server = vynelWorkspaceDescriptor.build(fakeContext())
    expect(server).not.toBeNull()
    expect(typeof server).toBe('object')
  })
})
