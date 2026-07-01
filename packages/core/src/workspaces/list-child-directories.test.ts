import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { ValidationError } from '@vynel/core/errors'
import { listChildDirectories } from './list-child-directories.js'

describe('listChildDirectories', () => {
  it('lists visible subdirectories (not files, not hidden), sorted, with a parent', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'vynel-browse-'))
    mkdirSync(path.join(base, 'beta'))
    mkdirSync(path.join(base, 'alpha'))
    mkdirSync(path.join(base, '.hidden'))
    writeFileSync(path.join(base, 'note.txt'), 'x')

    const listing = await listChildDirectories(base)

    expect(listing.entries.map((entry) => entry.name)).toEqual(['alpha', 'beta'])
    expect(listing.entries[0]!.path).toBe(path.join(listing.path, 'alpha'))
    expect(listing.parent).not.toBeNull()
  })

  it('defaults to the home directory when no path is given', async () => {
    const listing = await listChildDirectories()
    expect(listing.path).toBe(realpathSync(os.homedir()))
    expect(Array.isArray(listing.entries)).toBe(true)
  })

  it('includes drive/volume roots for switching volumes', async () => {
    const listing = await listChildDirectories()
    expect(Array.isArray(listing.drives)).toBe(true)
    expect(listing.drives.length).toBeGreaterThan(0)
  })

  it('throws ValidationError for a missing path', async () => {
    const missing = path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`)
    await expect(listChildDirectories(missing)).rejects.toThrow(ValidationError)
  })

  it('throws ValidationError when the path is a file', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'vynel-browse-'))
    const file = path.join(base, 'f.txt')
    writeFileSync(file, 'x')
    await expect(listChildDirectories(file)).rejects.toThrow(ValidationError)
  })
})
