// Pins the delegated-turn composer's DESCRIPTOR ROUTING (the 2026-07-21
// re-decision of the ④b pin): a workspace-root target composes the INTERACTIVE
// vynel descriptor (session-routing trio included), a spawned-session target
// the plain one — and schedule fires' plain composer never touches the
// interactive descriptor at all. The descriptors are mocked with markers
// because a built SDK server is opaque; the real composition output is covered
// by build-schedule-fire-deps.test.ts against the true registry.

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@vynel/db'

vi.mock('@vynel/mcp', () => ({
  vynelWorkspaceDescriptor: {
    serverName: 'vynel-plain',
    build: () => ({ marker: 'plain' }),
    mutatingToolNames: [],
  },
  vynelWorkspaceInteractiveDescriptor: {
    serverName: 'vynel-interactive',
    build: () => ({ marker: 'interactive' }),
    mutatingToolNames: [],
  },
}))
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: {
    serverName: 'vynel-notebook',
    build: () => ({ marker: 'notebook' }),
    mutatingToolNames: [],
  },
}))
vi.mock('@vynel/capabilities', () => ({
  listEnabledCapabilities: () => [],
}))

import {
  buildDelegatedTurnMcpComposer,
  buildWorkspaceBackgroundMcpComposer,
} from './build-workspace-background-mcp.js'

const appRequest = async () => new Response('{}', { status: 200 })
const target = { db: {} as Database, userId: 'user-1', workspaceId: 'ws-1' }

describe('buildDelegatedTurnMcpComposer', () => {
  it('routes a workspace-root target to the INTERACTIVE descriptor and a spawned-session target to the plain one', async () => {
    const compose = await buildDelegatedTurnMcpComposer(appRequest)

    const workspaceRoot = compose({ ...target, target: 'workspace-root' })
    expect(Object.keys(workspaceRoot.mcpServers)).toEqual(['vynel-interactive', 'vynel-notebook'])

    const spawned = compose({ ...target, target: 'spawned-session' })
    expect(Object.keys(spawned.mcpServers)).toEqual(['vynel-plain', 'vynel-notebook'])
  })
})

describe('buildWorkspaceBackgroundMcpComposer', () => {
  it('composes ONLY the plain descriptor (schedule fires never gain the routing trio)', async () => {
    const compose = await buildWorkspaceBackgroundMcpComposer(appRequest)
    expect(Object.keys(compose(target).mcpServers)).toEqual(['vynel-plain', 'vynel-notebook'])
  })
})
