// Tests for `handleAttachedImages`.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { handleAttachedImages } from './handle-attached-images.js'

describe('handleAttachedImages', () => {
  it('returns the message unchanged with a no-op cleanup when there are no attachments', async () => {
    const result = await handleAttachedImages({
      userMessageText: 'hello',
    })
    expect(result.modifiedPrompt).toBe('hello')
    await result.cleanup()
  })

  it('writes attached images to temp files and inlines path references', async () => {
    const base64Data = Buffer.from('fake-png-bytes').toString('base64')
    const result = await handleAttachedImages({
      userMessageText: 'look at this',
      attachedImages: [{ mimeType: 'image/png', base64Data }],
    })

    expect(result.modifiedPrompt).toContain('look at this')
    const match = result.modifiedPrompt.match(/\[Image: (.+)\]/)
    expect(match).not.toBeNull()

    const imagePath = match![1]!
    expect((await readFile(imagePath)).toString()).toBe('fake-png-bytes')

    await result.cleanup()
    await expect(readFile(imagePath)).rejects.toThrow()
  })

  it('keeps the original filename and labels non-images as attached files', async () => {
    const base64Data = Buffer.from('%PDF-fake').toString('base64')
    const result = await handleAttachedImages({
      userMessageText: 'summarize this',
      attachedImages: [{ filename: 'report.pdf', mimeType: 'application/pdf', base64Data }],
    })

    const match = result.modifiedPrompt.match(/\[Attached file: (.+)\]/)
    expect(match).not.toBeNull()
    expect(basename(match![1]!)).toBe('report.pdf')
    expect((await readFile(match![1]!)).toString()).toBe('%PDF-fake')

    await result.cleanup()
    await expect(readFile(match![1]!)).rejects.toThrow()
  })

  it('rejects an unsafe filename and de-collides duplicate names', async () => {
    const base64Data = Buffer.from('bytes').toString('base64')
    const result = await handleAttachedImages({
      userMessageText: 'two files',
      attachedImages: [
        { filename: '../escape.png', mimeType: 'image/png', base64Data },
        { filename: 'image.png', mimeType: 'image/png', base64Data },
        { filename: 'image.png', mimeType: 'image/png', base64Data },
      ],
    })

    const paths = [...result.modifiedPrompt.matchAll(/\[Image: (.+)\]/g)].map((m) => m[1]!)
    expect(paths).toHaveLength(3)
    // The traversal name fell back to a generated one, inside the temp dir.
    expect(basename(paths[0]!)).toMatch(/^attachment-.+\.png$/)
    // Duplicate names got distinct files.
    expect(new Set(paths.map((p) => basename(p))).size).toBe(3)

    await result.cleanup()
    await expect(readFile(paths[1]!)).rejects.toThrow()
  })
})
