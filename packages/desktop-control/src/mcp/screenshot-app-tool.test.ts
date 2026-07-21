import { describe, it, expect } from 'vitest'
import { buildScreenshotAppResponse } from './screenshot-app-tool.js'

describe('buildScreenshotAppResponse', () => {
  it('returns a labeling text block followed by the PNG image block', () => {
    const response = buildScreenshotAppResponse({
      pngBase64: 'aGVsbG8=',
      appName: 'Discord',
      windowTitle: '@user - Discord',
    })
    expect(response.content).toHaveLength(2)
    expect(response.content[0]).toEqual({
      type: 'text',
      text: 'Screenshot of "@user - Discord" (app: Discord):',
    })
    expect(response.content[1]).toEqual({
      type: 'image',
      data: 'aGVsbG8=',
      mimeType: 'image/png',
    })
  })
})
