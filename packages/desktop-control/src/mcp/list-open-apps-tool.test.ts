import { describe, it, expect } from 'vitest'
import { buildListOpenAppsResponse } from './list-open-apps-tool.js'
import type { OpenApp } from '../a11y/xa11y-adapter.js'

describe('buildListOpenAppsResponse', () => {
  it('returns the count and apps as JSON text', () => {
    const apps: OpenApp[] = [
      { name: 'Calculator', pid: 7228 },
      { name: 'YouTube - Google Chrome', pid: 111 },
    ]
    const parsed = JSON.parse(buildListOpenAppsResponse(apps).content[0]?.text ?? '') as {
      count: number
      apps: OpenApp[]
    }
    expect(parsed.count).toBe(2)
    expect(parsed.apps.map((app) => app.name)).toEqual(['Calculator', 'YouTube - Google Chrome'])
  })

  it('reports no open apps as count 0', () => {
    const parsed = JSON.parse(buildListOpenAppsResponse([]).content[0]?.text ?? '') as { count: number }
    expect(parsed.count).toBe(0)
  })
})
