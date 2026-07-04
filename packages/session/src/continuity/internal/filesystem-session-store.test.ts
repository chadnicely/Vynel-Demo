// Unit tests for the Phase-1 `FilesystemSessionStore`. Real temp dir (no
// mocking the filesystem).

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilesystemSessionStore } from './filesystem-session-store.js'

let rootDir = ''

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'vynel-session-store-'))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe('FilesystemSessionStore', () => {
  it('finds a persisted session by its <id>.jsonl path', async () => {
    const sessionId = 'sess-123'
    const expectedPath = join(rootDir, `${sessionId}.jsonl`)
    writeFileSync(expectedPath, '{}\n')
    const store = new FilesystemSessionStore(rootDir)

    expect(await store.hasSession(sessionId)).toBe(true)
    expect(await store.findSessionLocation(sessionId)).toBe(expectedPath)
  })

  it('reports a missing session as absent', async () => {
    const store = new FilesystemSessionStore(rootDir)
    expect(await store.hasSession('nope')).toBe(false)
    expect(await store.findSessionLocation('nope')).toBeNull()
  })
})
