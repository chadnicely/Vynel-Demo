import { describe, it, expect, vi } from 'vitest'
import type { DesktopScreenshot } from '../a11y/screenshot-desktop.js'
import { buildScreenshotDesktopResponse, makeScreenshotDesktopTool } from './screenshot-desktop-tool.js'

type BuiltTool = {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string; data?: string }>
  }>
}

const capture: DesktopScreenshot = {
  pngBase64: 'UEsDBA==',
  monitor: {
    id: 7,
    name: '\\\\.\\DISPLAY2',
    x: -1080,
    y: -847,
    width: 1080,
    height: 1920,
    scaleFactor: 1.25,
    rotationDegrees: 270,
    isPrimary: false,
  },
  width: 450,
  height: 800,
  scale: 0.41667,
}

describe('buildScreenshotDesktopResponse', () => {
  const captionOf = (response: { content: Array<{ type: string }> }): string => {
    const first = response.content[0]
    return first !== undefined && 'text' in first ? String((first as { text: unknown }).text) : ''
  }

  it('teaches the aiming math — a whole-screen point has no window-relative path to scale it', () => {
    const response = buildScreenshotDesktopResponse(capture)
    const caption = captionOf(response)
    // The monitor's NEGATIVE origin appears verbatim: that is the virtual-desktop
    // frame absolute clicks use, and "correct" negative coordinates are the
    // whole reason list_monitors exists.
    expect(caption).toContain('(-1080, -847)')
    expect(caption).toContain('x/0.417')
    expect(caption).toContain('screenshot_app')
    expect(response.content[1]).toEqual({ type: 'image', data: 'UEsDBA==', mimeType: 'image/png' })
  })

  it('skips the division story entirely when nothing was downscaled', () => {
    const response = buildScreenshotDesktopResponse({ ...capture, scale: 1, width: 1080, height: 1920 })
    const caption = captionOf(response)
    expect(caption).toContain('(-1080 + x, -847 + y)')
    expect(caption).not.toContain('/1.000')
  })
})

describe('screenshot_desktop', () => {
  it('captures the primary by default and a named monitor by id', async () => {
    const captureFn = vi.fn().mockResolvedValue(capture)
    const toolInstance = makeScreenshotDesktopTool({ capture: captureFn }) as BuiltTool
    await toolInstance.handler({})
    expect(captureFn).toHaveBeenLastCalledWith(undefined)
    await toolInstance.handler({ monitor: 7 })
    expect(captureFn).toHaveBeenLastCalledWith(7)
  })

  it('surfaces a capture failure as the real error', async () => {
    const captureFn = vi.fn().mockRejectedValue(new Error('No monitor has id 9. Call list_monitors — known ids: 1, 7.'))
    const toolInstance = makeScreenshotDesktopTool({ capture: captureFn }) as BuiltTool
    const result = await toolInstance.handler({ monitor: 9 })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('known ids: 1, 7')
  })
})
