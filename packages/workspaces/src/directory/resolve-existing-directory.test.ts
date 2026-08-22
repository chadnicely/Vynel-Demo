import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { ValidationError } from '@vynel/errors'
import { resolveExistingDirectory } from './resolve-existing-directory.js'

describe('resolveExistingDirectory', () => {
  it('returns the canonical path of an existing directory', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'vynel-resolve-'))
    expect(await resolveExistingDirectory(base)).toBe(realpathSync(base))
  })

  it('rejects a path that does not exist with a ValidationError', async () => {
    const missing = path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`)
    await expect(resolveExistingDirectory(missing)).rejects.toBeInstanceOf(ValidationError)
    await expect(resolveExistingDirectory(missing)).rejects.toThrow(/Pick a folder that exists/)
  })

  it('rejects a file with a ValidationError', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'vynel-resolve-'))
    const file = path.join(base, 'note.txt')
    writeFileSync(file, 'x')
    await expect(resolveExistingDirectory(file)).rejects.toThrow(/is not a directory/)
  })
})
