// Disk persistence + read-back + path-traversal defense for attached images.
// Pure fs (no DB) — uses a tmpdir workspace.

import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError, ValidationError } from '@vynel/errors'
import {
  persistAttachedImages,
  readAttachedImageBytes,
  imagesDirFor,
  assertSafeImageFilename,
} from './attached-images.js'

// 4 bytes of a PNG signature — enough to round-trip.
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

async function makeWorkspaceDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vynel-attached-images-'))
}

describe('attached-images', () => {
  it('persists images to the session images dir and reads them back', async () => {
    const workspacePath = await makeWorkspaceDir()
    await persistAttachedImages({
      workspacePath,
      sessionId: 'sess-1',
      images: [{ filename: 'shot.png', mimeType: 'image/png', base64Data: PNG_BASE64 }],
    })

    const onDisk = await readFile(join(imagesDirFor(workspacePath, 'sess-1'), 'shot.png'))
    expect(onDisk.toString('base64')).toBe(PNG_BASE64)

    const readBack = await readAttachedImageBytes({
      workspacePath,
      sessionId: 'sess-1',
      filename: 'shot.png',
    })
    expect(readBack.toString('base64')).toBe(PNG_BASE64)
  })

  it('rejects path-traversal filenames on write and read', async () => {
    const workspacePath = await makeWorkspaceDir()
    await expect(
      persistAttachedImages({
        workspacePath,
        sessionId: 's',
        images: [{ filename: '../escape.png', mimeType: 'image/png', base64Data: PNG_BASE64 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    await expect(
      readAttachedImageBytes({ workspacePath, sessionId: 's', filename: '../../secret' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('throws NotFoundError when the image file is missing', async () => {
    const workspacePath = await makeWorkspaceDir()
    await expect(
      readAttachedImageBytes({ workspacePath, sessionId: 'sess-x', filename: 'missing.png' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects separators and null bytes', () => {
    expect(() => assertSafeImageFilename('a/b.png')).toThrow(ValidationError)
    expect(() => assertSafeImageFilename('a\\b.png')).toThrow(ValidationError)
    expect(() => assertSafeImageFilename('a\0.png')).toThrow(ValidationError)
    expect(() => assertSafeImageFilename('')).toThrow(ValidationError)
    // A plain filename is accepted.
    expect(() => assertSafeImageFilename('ok-image.png')).not.toThrow()
  })
})
