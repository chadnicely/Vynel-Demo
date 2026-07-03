import { describe, it, expect } from 'vitest'
import { parseNotificationLine } from './parse-notification-line.js'

describe('parseNotificationLine', () => {
  it('normalizes a well-formed NDJSON line', () => {
    const line = JSON.stringify({
      id: '7',
      app: 'Slack',
      title: 'New message',
      body: 'Standup in 5',
      timestamp: '2026-06-26T10:00:00.000Z',
    })
    expect(parseNotificationLine(line)).toEqual({
      id: '7',
      app: 'Slack',
      title: 'New message',
      body: 'Standup in 5',
      timestamp: '2026-06-26T10:00:00.000Z',
    })
  })

  it('redacts a one-time code at ingest (title and body)', () => {
    const line = JSON.stringify({
      id: '9',
      app: 'Bank',
      title: 'Your code is 558211',
      body: 'Do not share 558211',
      timestamp: '2026-06-26T10:00:00.000Z',
    })
    const parsed = parseNotificationLine(line)
    expect(parsed?.title).toBe('Your code is [redacted code]')
    expect(parsed?.body).toBe('Do not share [redacted code]')
  })

  it('defaults a missing app to "unknown"', () => {
    const line = JSON.stringify({ id: '1', title: 'Hi', timestamp: '2026-06-26T10:00:00.000Z' })
    expect(parseNotificationLine(line)?.app).toBe('unknown')
  })

  it('falls back to a valid ISO timestamp when absent', () => {
    const line = JSON.stringify({ id: '1', app: 'Mail', title: 'Hi' })
    const parsed = parseNotificationLine(line)
    expect(parsed).not.toBeNull()
    expect(Number.isNaN(Date.parse(parsed?.timestamp ?? ''))).toBe(false)
  })

  it('returns null for a blank line', () => {
    expect(parseNotificationLine('   ')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseNotificationLine('{not valid json')).toBeNull()
  })

  it('returns null for a JSON array or scalar', () => {
    expect(parseNotificationLine('[]')).toBeNull()
    expect(parseNotificationLine('123')).toBeNull()
    expect(parseNotificationLine('"hello"')).toBeNull()
  })
})
