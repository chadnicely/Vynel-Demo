import { describe, it, expect } from 'vitest'
import type { Database } from '@vynel/db'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
import { PLAN_REQUIRED_MESSAGE } from '../plan/plan-gated-authorization.js'
import { buildDesktopMcpServer, desktopToolFactories } from './build-desktop-mcp-server.js'

const emptyReader: DesktopNotificationReader = { listSince: () => [] }
// Building the server only WIRES the db into tool closures (nothing queries at
// build time), so a structural stand-in is enough here — the access tests hit
// a real temp SQLite via @vynel/testing.
const dbStandIn = {} as Database

function toolNames(factories: unknown[]): string[] {
  return factories.map((toolDefinition) => (toolDefinition as { name: string }).name)
}

describe('buildDesktopMcpServer', () => {
  it('builds an in-process SDK server named "desktop"', () => {
    // The server KEY 'desktop' is what makes the tools `mcp__desktop__*`,
    // kept separate from the route-derived `vynel` server.
    const server = buildDesktopMcpServer({
      reader: emptyReader,
      db: dbStandIn,
      userId: 'user-1',
    }) as { type: string; name: string }
    expect(server.type).toBe('sdk')
    expect(server.name).toBe('desktop')
  })
})

describe('desktopToolFactories', () => {
  it('registers LOOKING only with actions OFF — and no consent tool at all', () => {
    const names = toolNames(desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u' }))
    expect(names).toEqual([
      'list_desktop_notifications',
      'list_open_apps',
      'list_installed_apps',
      // Display topology joins the ungated reads: knowing a screen EXISTS
      // reveals nothing about what is on it.
      'list_monitors',
      // The machine's own vitals — no app target, so it joins the ungated reads.
      'system_status',
      // ONE app's state, and the only tool here that truly touches nothing —
      // screenshot_app restores a minimized window to capture it.
      'get_app',
      'snapshot_app',
      'screenshot_app',
      // Read-only, so it rides the observe tier and needs no plan.
      'wait_for',
    ])
  })

  it('has NO request_desktop_access in any mode — the plan is the only consent', () => {
    // Per-app grants are retired: they asked a second time for consent the plan
    // already carries, in a vocabulary a non-technical user cannot evaluate.
    // A stray re-registration would resurrect a door with nothing behind it.
    for (const enableActions of [false, true]) {
      const names = toolNames(
        desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u', enableActions }),
      )
      expect(names).not.toContain('request_desktop_access')
    }
  })

  it('keeps BOTH clipboard tools behind actions — even the read', () => {
    // The clipboard is global, not app-scoped, so the per-app authorizer has
    // nothing to check it against; the plan envelope is its only gate. Reading
    // it can surface a password the user copied moments ago, so the read is
    // gated exactly like the write.
    const observeOnly = toolNames(
      desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u' }),
    )
    expect(observeOnly).not.toContain('read_clipboard')
    expect(observeOnly).not.toContain('write_clipboard')

    const acting = toolNames(
      desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u', enableActions: true }),
    )
    expect(acting).toContain('read_clipboard')
    expect(acting).toContain('write_clipboard')
  })

  it('adds the plan tool, the act tools and launch only when actions are enabled', () => {
    const names = toolNames(
      desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u', enableActions: true }),
    )
    expect(names).toContain('propose_desktop_plan')
    expect(names).toContain('act_on_app')
    expect(names).toContain('act_on_desktop')
    // Starting a program is an action — it must not exist on observe-only turns.
    expect(names).toContain('launch_app')
    // Arranging a window changes the screen — same rule.
    expect(names).toContain('set_window_state')
    // Moving/resizing is the same click-class change.
    expect(names).toContain('set_window_bounds')
    // Planning without acting is meaningless — observe-only turns carry no plan tool.
    const observeOnly = toolNames(
      desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u' }),
    )
    expect(observeOnly).not.toContain('propose_desktop_plan')
    expect(observeOnly).not.toContain('launch_app')
    expect(observeOnly).not.toContain('set_window_state')
    expect(observeOnly).not.toContain('set_window_bounds')
  })

  it('shares ONE envelope between the plan tool and the act tools (arming lifts the refusal)', async () => {
    type BuiltTool = {
      name: string
      handler: (args: Record<string, unknown>) => Promise<{
        isError?: boolean
        content: Array<{ type: string; text?: string }>
      }>
    }
    const factories = desktopToolFactories({
      reader: emptyReader,
      db: dbStandIn,
      userId: 'u',
      enableActions: true,
      planConsent: 'approval-card',
    }) as BuiltTool[]
    const findTool = (name: string) => factories.find((factory) => factory.name === name)!
    // The probe uses an INVALID action on purpose: the plan refusal fires
    // before action parsing, so the returned error tells us which gate hit —
    // without ever reaching the native execution layer.
    const probeArgs = { action: 'not-an-action' }

    const actOnApp = findTool('act_on_app')
    const actOnDesktop = findTool('act_on_desktop')
    const beforeApp = await actOnApp.handler(probeArgs)
    const beforeDesktop = await actOnDesktop.handler(probeArgs)
    expect(beforeApp.isError).toBe(true)
    expect(beforeApp.content[0]?.text).toContain('propose_desktop_plan')
    expect(beforeDesktop.content[0]?.text).toContain('propose_desktop_plan')

    const proposed = await findTool('propose_desktop_plan').handler({
      goal: 'g',
      steps: ['s'],
      apps: [{ app: 'Notepad', tier: 'click' }],
    })
    expect(proposed.isError).not.toBe(true)

    const afterApp = await actOnApp.handler(probeArgs)
    const afterDesktop = await actOnDesktop.handler(probeArgs)
    // The plan gate stood down — the probe now fails at the LATER argument
    // validation instead (both tools word that refusal with "EITHER a single").
    expect(afterApp.isError).toBe(true)
    expect(afterApp.content[0]?.text).toContain('EITHER a single')
    expect(afterApp.content[0]?.text).not.toContain(PLAN_REQUIRED_MESSAGE)
    expect(afterDesktop.isError).toBe(true)
    expect(afterDesktop.content[0]?.text).toContain('EITHER a single')
  })
})
