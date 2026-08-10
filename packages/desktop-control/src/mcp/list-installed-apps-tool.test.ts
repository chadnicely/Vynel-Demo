import { describe, it, expect } from 'vitest'
import { buildInstalledAppsResponse, makeListInstalledAppsTool } from './list-installed-apps-tool.js'
import type { InstalledApp } from '../apps/installed-apps.js'

type BuiltTool = {
  name: string
  annotations?: { readOnlyHint?: boolean }
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const INSTALLED: InstalledApp[] = [
  { name: 'Google Chrome', appId: 'chrome-id' },
  { name: 'Notepad', appId: 'notepad-id' },
]

function payloadOf(response: { content: Array<{ text?: string }> }): Record<string, unknown> {
  return JSON.parse(response.content[0]?.text ?? '{}')
}

describe('buildInstalledAppsResponse', () => {
  it('lists everything when no query is given', () => {
    const payload = payloadOf(buildInstalledAppsResponse(INSTALLED, undefined))
    expect(payload['count']).toBe(2)
    expect(payload['apps']).toEqual(INSTALLED)
  })

  it('filters and ranks by query', () => {
    const payload = payloadOf(buildInstalledAppsResponse(INSTALLED, 'chrome'))
    expect(payload['apps']).toEqual([{ name: 'Google Chrome', appId: 'chrome-id' }])
  })

  it('SAYS when it truncated — silence would read as "not installed"', () => {
    const many: InstalledApp[] = Array.from({ length: 75 }, (_, index) => ({
      name: `App ${index}`,
      appId: `id-${index}`,
    }))
    const payload = payloadOf(buildInstalledAppsResponse(many, undefined))
    expect(payload['count']).toBe(60)
    expect(payload['truncated']).toBe(15)
    expect(String(payload['hint'])).toContain('query')
  })

  it('tells the model plainly when a query matched nothing', () => {
    const payload = payloadOf(buildInstalledAppsResponse(INSTALLED, 'photoshop'))
    expect(payload['count']).toBe(0)
    expect(String(payload['note'])).toContain('photoshop')
  })
})

describe('makeListInstalledAppsTool', () => {
  it('is read-only (knowing an app exists grants nothing)', () => {
    const built = makeListInstalledAppsTool({ listApps: async () => INSTALLED }) as BuiltTool
    expect(built.name).toBe('list_installed_apps')
    expect(built.annotations?.readOnlyHint).toBe(true)
  })

  it('passes the query through', async () => {
    const built = makeListInstalledAppsTool({ listApps: async () => INSTALLED }) as BuiltTool
    const payload = payloadOf(await built.handler({ query: ' notepad ' }))
    expect(payload['apps']).toEqual([{ name: 'Notepad', appId: 'notepad-id' }])
  })

  it('surfaces a lookup failure as a tool error, never a thrown turn', async () => {
    const built = makeListInstalledAppsTool({
      listApps: async () => {
        throw new Error('powershell exploded')
      },
    }) as BuiltTool
    const result = await built.handler({})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('powershell exploded')
  })
})
