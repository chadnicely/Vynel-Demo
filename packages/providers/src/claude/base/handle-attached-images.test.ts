// Tests for `handleAttachedImages`.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { handleAttachedImages } from './handle-attached-images.js'

describe('handleAttachedImages', () => {
  it('returns the message unchanged with a no-op cleanup when there are no images', async () => {
    const result = await handleAttachedImages({
      userMessageText: 'hello',
      workspacePath: '/tmp/ws',
    })
    expect(result.modifiedPrompt).toBe('hello')
    await result.cleanup()
  })

  it('writes attached images to temp files and inlines path references', async () => {
    const base64Data = Buffer.from('fake-png-bytes').toString('base64')
    const result = await handleAttachedImages({
      userMessageText: 'look at this',
      attachedImages: [{ mimeType: 'image/png', base64Data }],
      workspacePath: '/tmp/ws',
    })

    expect(result.modifiedPrompt).toContain('look at this')
    const match = result.modifiedPrompt.match(/\[Image: (.+)\]/)
    expect(match).not.toBeNull()

    const imagePath = match![1]!
    expect((await readFile(imagePath)).toString()).toBe('fake-png-bytes')

    await result.cleanup()
    await expect(readFile(imagePath)).rejects.toThrow()
  })
})
