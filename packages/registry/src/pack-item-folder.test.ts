// Kind-aware folder packing: the entry-file gate per kind, the metadata /
// .git exclusions, and faithful nested content.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, it, expect, afterEach } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { packItemFolder } from './pack-item-folder.js'

const madeDirs: string[] = []

function makeFolder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-pack-fixture-'))
  madeDirs.push(dir)
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(dir, ...relativePath.split('/'))
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }
  return dir
}

afterEach(() => {
  for (const dir of madeDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('packItemFolder', () => {
  it('packs a skill folder faithfully, excluding vynel-item.json and .git', async () => {
    const folder = makeFolder({
      'SKILL.md': '# skill',
      'assets/grid.css': '.g{}',
      'vynel-item.json': '{"item":{}}',
      '.git/config': '[core]',
      'nested/.git/HEAD': 'ref: refs/heads/main',
    })
    const bytes = await packItemFolder(folder, 'skill')
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort()
    expect(names).toEqual(['SKILL.md', 'assets/grid.css'])
    expect(await zip.file('assets/grid.css')?.async('string')).toBe('.g{}')
  })

  it('refuses a folder containing a symlink — packing would dereference it', async () => {
    const folder = makeFolder({ 'SKILL.md': '# skill', 'secret.txt': 'outside' })
    // Capability probe: symlinkSync throws EPERM on Windows without Developer
    // Mode — the exact reason this hole is invisible locally and only real on
    // the Linux deploy. Probe instead of .skip so the test runs wherever it can.
    try {
      symlinkSync(join(folder, 'secret.txt'), join(folder, 'link.md'))
    } catch {
      return
    }
    await expect(packItemFolder(folder, 'skill')).rejects.toMatchObject({
      message: expect.stringContaining('symlink'),
    })
  })

  it('requires each kind to prove itself with its entry file', async () => {
    const agentFolder = makeFolder({ 'agent.json': '{"slug":"x"}' })
    await expect(packItemFolder(agentFolder, 'agent')).resolves.toBeInstanceOf(Buffer)
    // The same folder is NOT a publishable mcp folder.
    await expect(packItemFolder(agentFolder, 'mcp')).rejects.toBeInstanceOf(ValidationError)

    const skillless = makeFolder({ 'README.md': 'no entry file' })
    await expect(packItemFolder(skillless, 'skill')).rejects.toMatchObject({
      message: expect.stringContaining('no root SKILL.md'),
    })
  })

  it('a metadata-only folder is not publishable (nothing left to pack)', async () => {
    const folder = makeFolder({ 'vynel-item.json': '{}' })
    await expect(packItemFolder(folder, 'skill')).rejects.toBeInstanceOf(ValidationError)
  })
})
