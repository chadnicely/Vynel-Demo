import { describe, it, expect } from 'vitest'
import type {
  DesktopNotification,
  DesktopNotificationReader,
} from '../notifications/desktop-notification.js'
import {
  buildNotificationsResponse,
  makeListDesktopNotificationsTool,
} from './list-desktop-notifications-tool.js'

const sampleNotification = (overrides: Partial<DesktopNotification> = {}): DesktopNotification => ({
  id: '1',
  app: 'Slack',
  title: 'New message',
  body: 'Standup in 5',
  timestamp: '2026-06-26T10:00:00.000Z',
  ...overrides,
})

const fakeReader = (
  notifications: DesktopNotification[],
  capture?: { since?: string | undefined },
): DesktopNotificationReader => ({
  listSince(since) {
    if (capture) {
      capture.since = since
    }
    return notifications
  },
})

describe('buildNotificationsResponse', () => {
  it('returns the count and the notifications as JSON text', () => {
    const notifications = [sampleNotification(), sampleNotification({ id: '2', app: 'Mail' })]
    const response = buildNotificationsResponse(fakeReader(notifications))

    expect(response.content).toHaveLength(1)
    expect(response.content[0]?.type).toBe('text')
    const parsed = JSON.parse(response.content[0]?.text ?? '') as {
      count: number
      notifications: DesktopNotification[]
    }
    expect(parsed.count).toBe(2)
    expect(parsed.notifications.map((notification) => notification.app)).toEqual(['Slack', 'Mail'])
  })

  it('passes the since timestamp through to the reader', () => {
    const capture: { since?: string | undefined } = {}
    buildNotificationsResponse(fakeReader([], capture), '2026-06-26T09:00:00.000Z')
    expect(capture.since).toBe('2026-06-26T09:00:00.000Z')
  })

  it('reports an empty buffer as count 0', () => {
    const response = buildNotificationsResponse(fakeReader([]))
    const parsed = JSON.parse(response.content[0]?.text ?? '') as { count: number }
    expect(parsed.count).toBe(0)
  })
})

describe('makeListDesktopNotificationsTool', () => {
  it('constructs a read-only tool named list_desktop_notifications', () => {
    const toolDefinition = makeListDesktopNotificationsTool(fakeReader([])) as {
      name: string
      annotations?: { readOnlyHint?: boolean }
    }
    expect(toolDefinition.name).toBe('list_desktop_notifications')
    // Read-only is the safety contract: the PreToolUse backstop never cards a
    // read, so a typo flipping this would silently change the tool's risk class.
    expect(toolDefinition.annotations?.readOnlyHint).toBe(true)
  })
})
