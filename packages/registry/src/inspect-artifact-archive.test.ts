// The hub's publish-time archive wall: invalid zips, empty archives, entry
// floods, hostile paths, symlinks, case-fold collisions, and declared-size
// bombs are all refused; an honest artifact returns its facts.

import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { inspectArtifactArchive } from './inspect-artifact-archive.js'

// platform UNIX so unixPermissions (the symlink type bits) survive the
// generate→load round-trip, as they would in a real attacker-made archive.
async function zipBytes(build: (zip: JSZip) => void): Promise<Buffer> {
  const zip = new JSZip()
  build(zip)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' })
}

describe('inspectArtifactArchive', () => {
  it('accepts an honest artifact and reports its facts', async () => {
    const bytes = await zipBytes((zip) => {
      zip.file('SKILL.md', '# ok')
      zip.file('assets/grid.css', '.g{}')
      zip.folder('empty')
    })
    const facts = await inspectArtifactArchive(bytes)
    expect(facts.entryCount).toBe(2)
    expect(facts.declaredTotalBytes).toBeGreaterThan(0)
  })

  it('refuses bytes that are not a zip, and an entry-less archive', async () => {
    await expect(inspectArtifactArchive(Buffer.from('PK fake zip bytes'))).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('not a valid zip'),
    })
    const empty = await zipBytes(() => {})
    await expect(inspectArtifactArchive(empty)).rejects.toMatchObject({
      message: expect.stringContaining('empty'),
    })
  })

  it('refuses an entry flood past the cap', async () => {
    const bytes = await zipBytes((zip) => {
      for (let i = 0; i < 201; i += 1) zip.file(`f${i}.txt`, 'x')
    })
    await expect(inspectArtifactArchive(bytes)).rejects.toMatchObject({
      message: expect.stringContaining('too many entries'),
    })
  })

  it('refuses absolute, drive-letter, and backslash entry paths', async () => {
    for (const name of ['/etc/evil', 'C:/evil', 'a\\b.txt']) {
      const bytes = await zipBytes((zip) => zip.file(name, 'x'))
      await expect(inspectArtifactArchive(bytes)).rejects.toMatchObject({
        code: 'validation_failed',
      })
    }
  })

  it('refuses a symlink entry', async () => {
    const bytes = await zipBytes((zip) => {
      zip.file('SKILL.md', '# ok')
      zip.file('link', '/etc/passwd', { unixPermissions: 0o120755 })
    })
    await expect(inspectArtifactArchive(bytes)).rejects.toMatchObject({
      message: expect.stringContaining('symlink'),
    })
  })

  it('refuses case-fold collisions (last-write-wins on the install filesystem)', async () => {
    const bytes = await zipBytes((zip) => {
      zip.file('fonts/A.ttf', 'one')
      zip.file('Fonts/a.ttf', 'two')
    })
    await expect(inspectArtifactArchive(bytes)).rejects.toMatchObject({
      message: expect.stringContaining('collides'),
    })
  })

  it('refuses a declared-size bomb entry without inflating it', async () => {
    // 9 MB of zeros deflates to a few KB — only the DECLARED size gives the
    // bomb away before inflation.
    const bytes = await zipBytes((zip) => zip.file('bomb.bin', Buffer.alloc(9 * 1024 * 1024)))
    await expect(inspectArtifactArchive(bytes)).rejects.toMatchObject({
      message: expect.stringContaining('per-file size limit'),
    })
  })

  it('refuses an archive whose declared total inflates past the cap', async () => {
    // 5 × 7 MB = 35 MB declared > the 32 MB total cap, each under the 8 MB
    // per-entry cap.
    const bytes = await zipBytes((zip) => {
      for (let i = 0; i < 5; i += 1) zip.file(`z${i}.bin`, Buffer.alloc(7 * 1024 * 1024))
    })
    await expect(inspectArtifactArchive(bytes)).rejects.toMatchObject({
      message: expect.stringContaining('total size limit'),
    })
  }, 30_000)
})
