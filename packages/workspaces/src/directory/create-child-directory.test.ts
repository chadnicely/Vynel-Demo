import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { ConflictError, ValidationError } from '@vynel/errors'
import { createChildDirectory } from './create-child-directory.js'

function makeParent(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'vynel-newfolder-'))
}

describe('createChildDirectory', () => {
  it('creates the folder inside the parent and returns its entry', async () => {
    const parent = makeParent()
    const created = await createChildDirectory(parent, ' Bookkeeping ')

    expect(created.name).toBe('Bookkeeping')
    expect(statSync(created.path).isDirectory()).toBe(true)
    expect(path.dirname(created.path).toLowerCase()).toBe(
      path.dirname(path.join(parent, 'x')).toLowerCase(),
    )
  })

  it('refuses an empty name, dot names, separators, and Windows-forbidden characters', async () => {
    const parent = makeParent()
    for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'what?', 'a:b', 'ends.', 'CON', 'nul.txt']) {
      await expect(createChildDirectory(parent, bad)).rejects.toThrow(ValidationError)
    }
    expect(existsSync(path.join(parent, 'a'))).toBe(false)
  })

  it('reports an existing folder as a conflict, not a validation slip', async () => {
    const parent = makeParent()
    await createChildDirectory(parent, 'Twice')
    await expect(createChildDirectory(parent, 'Twice')).rejects.toThrow(ConflictError)
  })

  it('throws ValidationError when the parent is missing or is a file', async () => {
    const missing = path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`)
    await expect(createChildDirectory(missing, 'x')).rejects.toThrow(ValidationError)

    const parent = makeParent()
    const file = path.join(parent, 'f.txt')
    writeFileSync(file, 'x')
    await expect(createChildDirectory(file, 'x')).rejects.toThrow(ValidationError)
  })
})
