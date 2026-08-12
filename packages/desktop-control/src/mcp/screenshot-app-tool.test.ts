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
    restored: false,
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


/** The caption block, the way the existing assertions above unwrap it (the
 *  content union carries an image block too). */
function captionOf(response: { content: Array<unknown> }): string {
  const block = response.content[0] as { type: string; text?: string } | undefined
  return block !== undefined && block.type === 'text' ? (block.text ?? '') : ''
}

// A capture that un-minimizes a window CHANGES WHAT IS ON THE USER'S SCREEN.
// It used to do that silently, which is the one thing a "read" must not do —
// the whole reason `get_app` now exists is so the model can know beforehand.
describe('buildScreenshotAppResponse — a restored window is never silent', () => {
  it('says so when the capture had to un-minimize the window', () => {
    const text = captionOf(buildScreenshotAppResponse(makeScreenshot({ restored: true })))
    expect(text).toMatch(/MINIMIZED and has been restored/)
    expect(text).toMatch(/on the user's screen/)
  })

  it('says nothing when the window was already visible', () => {
    const text = captionOf(buildScreenshotAppResponse(makeScreenshot()))
    expect(text).not.toMatch(/restored/i)
  })

  it('still says so on a ZOOMED capture', () => {
    // The zoom branch builds its own caption — an easy place for the note to
    // get lost, and the restore is just as real there.
    const text = captionOf(
      buildScreenshotAppResponse(
        makeScreenshot({ restored: true, region: { x: 0, y: 0, width: 10, height: 10 } }),
      ),
    )
    expect(text).toMatch(/MINIMIZED and has been restored/)
  })
})
