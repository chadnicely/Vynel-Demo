import { describe, it, expect } from 'vitest'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
import { buildDesktopMcpServer } from './build-desktop-mcp-server.js'

const emptyReader: DesktopNotificationReader = { listSince: () => [] }

describe('buildDesktopMcpServer', () => {
  it('builds an in-process SDK server named "desktop"', () => {
    // The server KEY 'desktop' is what makes the tools `mcp__desktop__*`,
    // kept separate from the route-derived `vynel` server.
    const server = buildDesktopMcpServer({ reader: emptyReader }) as { type: string; name: string }
    expect(server.type).toBe('sdk')
    expect(server.name).toBe('desktop')
  })
})
