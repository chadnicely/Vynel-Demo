import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { resolveIndexableSourceKind } from './path-safety.js'

describe('resolveIndexableSourceKind', () => {
  it('resolves an existing readable directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-ps-'))
    try {
      expect(resolveIndexableSourceKind(dir)).toBe('directory')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves a supported single file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-ps-'))
    const file = path.join(dir, 'notes.md')
    try {
      await writeFile(file, '# notes', 'utf8')
      expect(resolveIndexableSourceKind(file)).toBe('file')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a single file the indexer cannot parse', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-ps-'))
    const file = path.join(dir, 'setup.exe')
    try {
      await writeFile(file, 'MZ', 'utf8')
      expect(() => resolveIndexableSourceKind(file)).toThrow(/can't be indexed/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a non-existent path', () => {
    expect(() => resolveIndexableSourceKind(path.join(tmpdir(), 'nope-xyz-123'))).toThrow()
  })

  it('rejects a relative path', () => {
    expect(() => resolveIndexableSourceKind('relative/dir')).toThrow()
  })

  it('rejects the home-directory root', () => {
    expect(() => resolveIndexableSourceKind(homedir())).toThrow()
  })
})
