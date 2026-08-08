import { describe, it, expect } from 'vitest'
import type { Database } from '@vynel/db'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
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
  it('registers request_desktop_access even with actions OFF (read tools need grants too)', () => {
    const names = toolNames(desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u' }))
    expect(names).toEqual([
      'list_desktop_notifications',
      'list_open_apps',
      'snapshot_app',
      'screenshot_app',
      'request_desktop_access',
    ])
  })

  it('adds the two act tools only when actions are enabled', () => {
    const names = toolNames(
      desktopToolFactories({ reader: emptyReader, db: dbStandIn, userId: 'u', enableActions: true }),
    )
    expect(names).toContain('act_on_app')
    expect(names).toContain('act_on_desktop')
  })
})
