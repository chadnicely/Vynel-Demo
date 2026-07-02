import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertIndexableDirectory } from './path-safety.js'

describe('assertIndexableDirectory', () => {
  it('accepts an existing readable directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-ps-'))
    try {
      expect(() => assertIndexableDirectory(dir)).not.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a non-existent path', () => {
    expect(() => assertIndexableDirectory(path.join(tmpdir(), 'nope-xyz-123'))).toThrow()
  })

  it('rejects a file (not a directory)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-ps-'))
    const file = path.join(dir, 'f.txt')
    try {
      await writeFile(file, 'x', 'utf8')
      expect(() => assertIndexableDirectory(file)).toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a relative path', () => {
    expect(() => assertIndexableDirectory('relative/dir')).toThrow()
  })
})
