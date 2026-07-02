// Integration tests for streamFileBytes. Returns the metadata the
// route uses; the actual streaming happens at the HTTP boundary.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { streamFileBytes } from './stream-file-bytes.js'
import { seedUserAndWorkspace } from './_test-helpers.js'

describe('streamFileBytes', () => {
  it('returns absolutePath + content-type + size for a file', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'logo.png'), Buffer.from([0x89, 0x50]))

      const result = await streamFileBytes({ workspacePath, relativePath: 'logo.png' })
      expect(result.absolutePath).toBe(path.join(workspacePath, 'logo.png'))
      expect(result.normalizedRelativePath).toBe('logo.png')
      expect(result.contentType).toBe('image/png')
      expect(result.fileSizeBytes).toBe(2)

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('infers the content type for a markdown file', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await writeFile(path.join(workspacePath, 'r.md'), 'x')

      const result = await streamFileBytes({ workspacePath, relativePath: 'r.md' })
      expect(result.contentType).toBe('text/markdown; charset=utf-8')

      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('throws NotFoundError when the path resolves to a directory', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await mkdir(path.join(workspacePath, 'subdir'))
      await expect(
        streamFileBytes({ workspacePath, relativePath: 'subdir' }),
      ).rejects.toThrow(/not found/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('throws NotFoundError for a missing file', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        streamFileBytes({ workspacePath, relativePath: 'missing.bin' }),
      ).rejects.toThrow(/not found/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })

  it('rejects a `..` escape', async () => {
    await withTestDatabase(async (db) => {
      const { workspacePath } = await seedUserAndWorkspace(db)
      await expect(
        streamFileBytes({ workspacePath, relativePath: '../escape.bin' }),
      ).rejects.toThrow(/outside the workspace/i)
      await rm(workspacePath, { recursive: true, force: true })
    })
  })
})
