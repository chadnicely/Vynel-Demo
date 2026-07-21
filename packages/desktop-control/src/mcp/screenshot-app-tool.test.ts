import { describe, it, expect } from 'vitest'
import { buildScreenshotAppResponse } from './screenshot-app-tool.js'

describe('buildScreenshotAppResponse', () => {
  it('returns a labeling text block (with the window size + coord frame) then the PNG', () => {
    const response = buildScreenshotAppResponse({
      pngBase64: 'aGVsbG8=',
      appName: 'Discord',
      windowTitle: '@user - Discord',
      width: 1280,
      height: 720,
    })
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
})
