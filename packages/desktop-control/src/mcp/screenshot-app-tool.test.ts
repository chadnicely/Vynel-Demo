import { describe, it, expect } from 'vitest'
import { buildScreenshotAppResponse } from './screenshot-app-tool.js'
import type { AppScreenshot } from '../a11y/screenshot-adapter.js'

function makeScreenshot(overrides: Partial<AppScreenshot> = {}): AppScreenshot {
  return {
    pngBase64: 'aGVsbG8=',
    appName: 'Discord',
    windowTitle: '@user - Discord',
    width: 1280,
    height: 720,
    windowWidth: 1280,
    windowHeight: 720,
    scale: 1,
    region: null,
    ...overrides,
  }
}

describe('buildScreenshotAppResponse', () => {
  it('returns a labeling text block (with the image size + coord frame) then the PNG', () => {
    const response = buildScreenshotAppResponse(makeScreenshot())
    expect(response.content).toHaveLength(2)
    const text = response.content[0]
    expect(text?.type).toBe('text')
    expect(text && 'text' in text ? text.text : '').toContain('1280×720px')
    expect(text && 'text' in text ? text.text : '').toContain('act_on_desktop with app="Discord"')
    expect(response.content[1]).toEqual({
      type: 'image',
      data: 'aGVsbG8=',
      mimeType: 'image/png',
    })
  })

  it('discloses the downscale when the capture was fitted toward WXGA', () => {
    const response = buildScreenshotAppResponse(
      makeScreenshot({ width: 1280, height: 800, windowWidth: 1920, windowHeight: 1200, scale: 2 / 3 }),
    )
    const text = response.content[0]
    const caption = text && 'text' in text ? text.text : ''
    expect(caption).toContain('1280×800px')
    expect(caption).toContain('window 1920×1200px, downscaled')
  })

  it('labels a zoomed region as read-only detail (not the act frame)', () => {
    const response = buildScreenshotAppResponse(
      makeScreenshot({
        width: 300,
        height: 200,
        windowWidth: 1920,
        windowHeight: 1200,
        region: { x: 100, y: 50, width: 300, height: 200 },
      }),
    )
    const text = response.content[0]
    const caption = text && 'text' in text ? text.text : ''
    expect(caption).toContain('Zoomed')
    expect(caption).toContain('do not use zoomed-image coordinates')
  })
})
