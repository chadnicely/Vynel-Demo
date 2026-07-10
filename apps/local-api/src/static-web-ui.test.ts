// Containment + content-type contract for the hand-rolled dist server. The
// traversal cases are the reason this file exists — the responder runs on
// every request the sidecar-mode desktop app makes.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveWebUiFilePath, respondWithWebUiFile } from './static-web-ui.js'

describe('resolveWebUiFilePath', () => {
  let distDir: string

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'vynel-static-test-'))
    writeFileSync(join(distDir, 'index.html'), '<html></html>')
    mkdirSync(join(distDir, 'assets'))
    writeFileSync(join(distDir, 'assets', 'style.css'), 'body{}')
  })

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true })
  })

  it('resolves an existing file', () => {
    expect(resolveWebUiFilePath(distDir, '/index.html')).toBe(join(distDir, 'index.html'))
    expect(resolveWebUiFilePath(distDir, '/assets/style.css')).toBe(
      join(distDir, 'assets', 'style.css'),
    )
  })

  it('returns null for a missing file and for a directory', () => {
    expect(resolveWebUiFilePath(distDir, '/nope.js')).toBeNull()
    expect(resolveWebUiFilePath(distDir, '/assets')).toBeNull()
  })

  it('rejects traversal, encoded traversal, null bytes, and undecodable paths', () => {
    writeFileSync(join(distDir, '..', 'vynel-static-test-outside.txt'), 'outside')
    try {
      expect(resolveWebUiFilePath(distDir, '/../vynel-static-test-outside.txt')).toBeNull()
      expect(resolveWebUiFilePath(distDir, '/%2e%2e/vynel-static-test-outside.txt')).toBeNull()
      expect(resolveWebUiFilePath(distDir, '/index.html%00.js')).toBeNull()
      expect(resolveWebUiFilePath(distDir, '/%zz')).toBeNull()
    } finally {
      rmSync(join(distDir, '..', 'vynel-static-test-outside.txt'), { force: true })
    }
  })
})

describe('respondWithWebUiFile', () => {
  let distDir: string

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'vynel-static-test-'))
    writeFileSync(join(distDir, 'index.html'), '<html></html>')
    mkdirSync(join(distDir, 'assets'))
    writeFileSync(join(distDir, 'assets', 'app-1a2b.js'), 'x')
  })

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true })
  })

  it('sets content-type by extension and revalidating cache for the shell', async () => {
    const response = respondWithWebUiFile(distDir, join(distDir, 'index.html'))
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toBe('<html></html>')
  })

  it('marks hashed assets immutable', () => {
    const response = respondWithWebUiFile(distDir, join(distDir, 'assets', 'app-1a2b.js'))
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })
})
