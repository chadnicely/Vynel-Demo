// Zip-bomb walls of the skill-artifact extractor: the raw-input cap fires
// BEFORE any archive parsing, and the declared-uncompressed-size guard
// fires BEFORE inflating the SKILL.md entry. Happy-path extraction is
// covered end-to-end by lifecycle/install-cloud-skill.test.ts.

import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { extractSkillMarkdown } from './extract-skill-markdown.js'

describe('extractSkillMarkdown', () => {
  it('rejects a raw artifact larger than the 10 MB cap before parsing', async () => {
    // Not a zip at all — proves the size wall fires before loadAsync,
    // otherwise the error would be the "not a valid archive" one.
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1)
    await expect(extractSkillMarkdown(oversized)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('exceeds the size limit'),
    })
  })

  it('rejects a SKILL.md whose declared uncompressed size exceeds the per-file cap', async () => {
    const zip = new JSZip()
    // 600 KB > the 512 KB per-file cap, while the archive stays tiny deflated.
    zip.file('SKILL.md', 'a'.repeat(600 * 1024))
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    expect(bytes.byteLength).toBeLessThan(10 * 1024 * 1024)
    await expect(extractSkillMarkdown(bytes)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('SKILL.md exceeds the size limit'),
    })
  })
})
