// The write-to-disk guard wall of the skill-artifact extractor: zip-bomb
// caps (raw input BEFORE parsing, declared-size BEFORE inflating) carried
// over from the markdown-only predecessor, plus the per-entry path wall
// (traversal / absolute / backslash / symlink) that multi-file extraction
// requires. Happy-path extraction is covered end-to-end by
// lifecycle/install-cloud-skill.test.ts + update-cloud-skill.test.ts.

import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { extractSkillArchive } from './extract-skill-archive.js'

// platform UNIX so unixPermissions (the symlink type bits) survive the
// generate→load round-trip, as they would in a real attacker-made archive.
async function zipBytes(build: (zip: JSZip) => void): Promise<Buffer> {
  const zip = new JSZip()
  build(zip)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' })
}

describe('extractSkillArchive', () => {
  it('rejects a raw artifact larger than the 10 MB cap before parsing', async () => {
    // Not a zip at all — proves the size wall fires before loadAsync,
    // otherwise the error would be the "not a valid archive" one.
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1)
    await expect(extractSkillArchive(oversized)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('exceeds the size limit'),
    })
  })

  it('rejects a SKILL.md whose declared uncompressed size exceeds the per-file cap', async () => {
    // 600 KB > the 512 KB per-file cap, while the archive stays tiny deflated.
    const bytes = await zipBytes((zip) => zip.file('SKILL.md', 'a'.repeat(600 * 1024)))
    await expect(extractSkillArchive(bytes)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('SKILL.md exceeds the size limit'),
    })
  })

  it('rejects a missing root SKILL.md', async () => {
    const bytes = await zipBytes((zip) => zip.file('nested/SKILL.md', '# hidden'))
    await expect(extractSkillArchive(bytes)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('missing SKILL.md'),
    })
  })

  it('rejects absolute, drive-letter, and backslash entry paths', async () => {
    for (const name of ['/etc/evil', 'C:/evil', 'a\\b.txt']) {
      const bytes = await zipBytes((zip) => {
        zip.file('SKILL.md', '# ok')
        zip.file(name, 'x')
      })
      await expect(extractSkillArchive(bytes)).rejects.toMatchObject({
        code: 'validation_failed',
      })
    }
  })

  it('canary: jszip sanitizes a crafted `..` entry on load (our guard is defense-in-depth)', async () => {
    // A hostile name must be byte-patched in — same-length rename keeps
    // every zip offset valid, and entry names carry no checksum. jszip's
    // loadAsync then resolves the '..' away (its CVE-2021-23413 fix), so the
    // extractor's own '..' guard is unreachable through this library. If
    // this canary ever fails, jszip stopped sanitizing and our guard just
    // became load-bearing — re-verify it fires before touching anything.
    const benign = await zipBytes((zip) => {
      zip.file('SKILL.md', '# ok')
      zip.file('aa/evil.txt', 'x')
    })
    const hostile = Buffer.from(
      benign.toString('latin1').replaceAll('aa/evil.txt', '../evil.txt'),
      'latin1',
    )
    const archive = await extractSkillArchive(hostile)
    expect(archive.resources.map((r) => r.relativePath)).toEqual(['evil.txt'])
  })

  it('rejects case-insensitive collisions, including a skill.md root variant', async () => {
    const variant = await zipBytes((zip) => {
      zip.file('SKILL.md', '# ok')
      zip.file('skill.md', 'impostor past the 512KB cap wall')
    })
    await expect(extractSkillArchive(variant)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('collides'),
    })

    const duplicate = await zipBytes((zip) => {
      zip.file('SKILL.md', '# ok')
      zip.file('fonts/A.ttf', 'one')
      zip.file('Fonts/a.ttf', 'two')
    })
    await expect(extractSkillArchive(duplicate)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('collides'),
    })
  })

  it('rejects a symlink entry', async () => {
    const bytes = await zipBytes((zip) => {
      zip.file('SKILL.md', '# ok')
      // S_IFLNK type bits mark the entry as a symlink to /etc/passwd.
      zip.file('link', '/etc/passwd', { unixPermissions: 0o120755 })
    })
    await expect(extractSkillArchive(bytes)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('symlink'),
    })
  })

  it('extracts nested resources and skips directory entries', async () => {
    const bytes = await zipBytes((zip) => {
      zip.file('SKILL.md', '# Canvas')
      zip.file('fonts/Arsenal.ttf', Buffer.from([1, 2, 3]))
      zip.folder('empty')
    })
    const archive = await extractSkillArchive(bytes)
    expect(archive.markdown).toBe('# Canvas')
    expect(archive.resources.map((r) => r.relativePath)).toEqual(['fonts/Arsenal.ttf'])
    expect(archive.resources[0]!.bytes).toEqual(Buffer.from([1, 2, 3]))
  })
})
