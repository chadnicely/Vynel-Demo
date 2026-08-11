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
    // Captures the dispatcher the composer hands the descriptor — the
    // caller-header tests below drive a request through it.
    build: (context: { appRequest: unknown }) => ({ marker: 'plain', appRequest: context.appRequest }),
    mutatingToolNames: [],
  },
  vynelWorkspaceInteractiveDescriptor: {
    serverName: 'vynel-interactive',
    build: (context: { appRequest: unknown }) => ({
      marker: 'interactive',
      appRequest: context.appRequest,
    }),
    mutatingToolNames: [],
  },
  // A GLOBAL-grounded spawned session inherits the ROOT's toolset (2026-07-26).
  vynelRoutingDescriptor: {
    serverName: 'vynel-routing',
    build: (context: { appRequest: unknown }) => ({
      marker: 'routing',
      appRequest: context.appRequest,
    }),
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
// Mirrors the real descriptor's applicability gate: it excludes ITSELF when no
// reader was wired at boot, which is what keeps composition safe off-Windows.
vi.mock('@vynel/desktop-control', () => ({
  desktopFeatureDescriptor: {
    serverName: 'desktop',
    build: (context: { desktopReader?: unknown; desktopPlanConsent?: string; enableDesktopActions?: boolean }) =>
      context.desktopReader === undefined
        ? null
        : {
            marker: 'desktop',
            planConsent: context.desktopPlanConsent,
            actionsEnabled: context.enableDesktopActions,
          },
    mutatingToolNames: ['mcp__desktop__request_desktop_access'],
  },
}))

import {
  buildDelegatedTurnMcpComposer,
  buildWorkspaceBackgroundMcpComposer,
} from './build-workspace-background-mcp.js'
import { parseReportCallerHeader, REPORT_CALLER_HEADER } from './report-caller-header.js'
import type { HonoAppRequestFn } from '../factory.js'

const target = { db: {} as Database, userId: 'user-1', workspaceId: 'ws-1' }

// A spy dispatcher: records the caller header of every request the composed
// descriptors dispatch (the wrap happens per compose call — per JOB).
function makeSpyAppRequest() {
  const callerHeaders: Array<string | null> = []
  const appRequest: HonoAppRequestFn = (async (_input: unknown, init?: RequestInit) => {
    callerHeaders.push(new Headers(init?.headers).get(REPORT_CALLER_HEADER))
    return new Response('{}', { status: 200 })
  }) as HonoAppRequestFn
  return { appRequest, callerHeaders }
}

// The dispatcher a composed server's tools would use — captured by the mocked
// descriptor's build (see the vi.mock above).
function dispatcherOf(server: unknown): HonoAppRequestFn {
  return (server as { appRequest: HonoAppRequestFn }).appRequest
}

describe('buildDelegatedTurnMcpComposer', () => {
  // SPEC CHANGE (2026-07-26, Chad): a spawned session now inherits its PARENT's
  // toolset, so BOTH delegated targets get the interactive descriptor. This
  // reverses the earlier "the leaf, not a router" pin that kept spawning tools
  // away from spawned sessions.
  it('routes both delegated targets to the INTERACTIVE descriptor (a spawned session inherits its parent)', async () => {
    const { appRequest } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest)

    const workspaceRoot = compose({ ...target, target: 'workspace-root' })
    expect(Object.keys(workspaceRoot.mcpServers)).toEqual(['vynel-interactive', 'vynel-notebook'])

    const spawned = compose({ ...target, target: 'spawned-session', targetPrimarySessionId: 'sp-1' })
    expect(Object.keys(spawned.mcpServers)).toEqual(['vynel-interactive', 'vynel-notebook'])
  })

  it('stamps the caller-identity header per target (session-comms): workspace-root = the workspace primary, spawned-session = the SESSION', async () => {
    const { appRequest, callerHeaders } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest)

    const workspaceRoot = compose({ ...target, target: 'workspace-root' })
    await dispatcherOf(workspaceRoot.mcpServers['vynel-interactive'])('/routing/message', {
      method: 'POST',
    })
    expect(parseReportCallerHeader(callerHeaders[0] ?? undefined)).toEqual({
      kind: 'workspace-primary',
      workspaceId: 'ws-1',
    })

    const spawned = compose({ ...target, target: 'spawned-session', targetPrimarySessionId: 'sp-1' })
    await dispatcherOf(spawned.mcpServers['vynel-interactive'])('/routing/message', { method: 'POST' })
    expect(parseReportCallerHeader(callerHeaders[1] ?? undefined)).toEqual({
      kind: 'spawned-session',
      targetPrimarySessionId: 'sp-1',
    })
  })

  it('a spawned target WITHOUT a primary id gets NO caller header (fail-safe: 400 over mis-addressing as the workspace)', async () => {
    const { appRequest, callerHeaders } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest)
    const spawned = compose({ ...target, target: 'spawned-session' })
    await dispatcherOf(spawned.mcpServers['vynel-interactive'])('/routing/message', { method: 'POST' })
    expect(callerHeaders[0]).toBeNull()
  })
})

// Desktop autopilot (Kafi, 2026-08-11): a task handed to a SPAWNED session is
// the only way desktop work runs while the user does something else — a
// global-root turn holds the per-user root lock for its whole life. These pin
// both halves: that the spawned target GETS the feature, and that the targets
// deliberately left out do NOT.
describe('buildDelegatedTurnMcpComposer — desktop attachment', () => {
  const desktopWired = { desktopReader: { listSince: () => [] }, enableDesktopActions: true }

  it('attaches desktop to a SPAWNED session (the autopilot unlock)', async () => {
    const { appRequest } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest, desktopWired)
    const spawned = compose({ ...target, target: 'spawned-session', targetPrimarySessionId: 'sp-1' })
    expect(Object.keys(spawned.mcpServers)).toContain('desktop')
  })

  it('attaches desktop to a GLOBAL-grounded spawned session too — the desktop is the machine, not a workspace', async () => {
    const { appRequest } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest, desktopWired)
    const spawned = compose({
      ...target,
      workspaceId: null,
      target: 'spawned-session',
      targetPrimarySessionId: 'sp-1',
    })
    expect(Object.keys(spawned.mcpServers)).toEqual(['vynel-routing', 'vynel-notebook', 'desktop'])
  })

  it('does NOT attach desktop to a workspace-root or agent-session target (scope: spawned only, for now)', async () => {
    const { appRequest } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest, desktopWired)
    expect(Object.keys(compose({ ...target, target: 'workspace-root' }).mcpServers)).not.toContain(
      'desktop',
    )
    expect(
      Object.keys(
        compose({ ...target, target: 'agent-session', targetPrimarySessionId: 'ag-1' }).mcpServers,
      ),
    ).not.toContain('desktop')
  })

  it('attaches nothing when no reader was wired (off-Windows / tests) — the descriptor self-excludes', async () => {
    const { appRequest } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest)
    const spawned = compose({ ...target, target: 'spawned-session', targetPrimarySessionId: 'sp-1' })
    expect(Object.keys(spawned.mcpServers)).not.toContain('desktop')
  })

  // Pins exactly ONE property, and no more: the PLAN is not an authority path
  // for a spawned turn. Absent consent ⇒ 'display-only' by contract, so an
  // armed plan narrates on the overlay but authorizes nothing itself; authority
  // must come from a standing per-app grant.
  //
  // ⚠ This is NOT "a spawned turn can never self-grant". The standing-grant
  // door is still open to it: a delegated turn inherits the dispatching root
  // turn's permission mode, and in the user's own `auto`/`bypass` the approval
  // floor stands down (`build-claude-pre-tool-use-hook.ts` — `floorStandsDown`),
  // so `request_desktop_access` runs UNCARDED and grants directly. Closing that
  // needs a way to force a card for one tool even in auto/bypass, which is a
  // provider-level change and a product call — recorded as an open decision in
  // `docs/module-notes/desktop-autopilot.md`. Do not widen this test's name
  // back to the strict claim without the code to back it.
  it('leaves plan consent ABSENT so an armed plan is not itself an authority path', async () => {
    const { appRequest } = makeSpyAppRequest()
    const compose = await buildDelegatedTurnMcpComposer(appRequest, desktopWired)
    const spawned = compose({ ...target, target: 'spawned-session', targetPrimarySessionId: 'sp-1' })
    const desktopServer = spawned.mcpServers['desktop'] as { planConsent?: string }
    expect(desktopServer.planConsent).toBeUndefined()
  })

  it('carries the boot actions flag through', async () => {
    const { appRequest } = makeSpyAppRequest()
    const off = await buildDelegatedTurnMcpComposer(appRequest, {
      ...desktopWired,
      enableDesktopActions: false,
    })
    const spawned = off({ ...target, target: 'spawned-session', targetPrimarySessionId: 'sp-1' })
    expect((spawned.mcpServers['desktop'] as { actionsEnabled?: boolean }).actionsEnabled).toBe(false)
  })
})

describe('buildWorkspaceBackgroundMcpComposer', () => {
  it('composes ONLY the plain descriptor (schedule fires never gain the routing trio) and stamps NO caller header (autonomous turns have no requester)', async () => {
    const { appRequest, callerHeaders } = makeSpyAppRequest()
    const compose = await buildWorkspaceBackgroundMcpComposer(appRequest)
    const composed = compose(target)
    expect(Object.keys(composed.mcpServers)).toEqual(['vynel-plain', 'vynel-notebook'])
    await dispatcherOf(composed.mcpServers['vynel-plain'])('/routing/message', { method: 'POST' })
    expect(callerHeaders[0]).toBeNull()
  })
})
