import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readLivePort,
  removePortFile,
  resolveEngineUrl,
  writePortFile,
} from './port-file.js'

const tempDirs: string[] = []

function tempPortFilePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-port-file-'))
  tempDirs.push(dir)
  return join(dir, 'engine.port')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readLivePort', () => {
  it('answers the port when the recorded pid is alive', () => {
    const filePath = tempPortFilePath()
    writePortFile(filePath, { port: 28_892, pid: process.pid })
    expect(readLivePort(filePath)).toBe(28_892)
  })

  it('answers null for a stale file whose pid is dead', () => {
    const filePath = tempPortFilePath()
    // The max-range pid is never a real process on any supported platform.
    writePortFile(filePath, { port: 28_892, pid: 2_147_483_647 })
    expect(readLivePort(filePath)).toBeNull()
  })

  it('answers null for a missing file, garbage content, and bad shapes', () => {
    const filePath = tempPortFilePath()
    expect(readLivePort(filePath)).toBeNull()

    writeFileSync(filePath, 'not-json')
    expect(readLivePort(filePath)).toBeNull()

    writeFileSync(filePath, JSON.stringify({ port: 'abc', pid: process.pid }))
    expect(readLivePort(filePath)).toBeNull()

    writeFileSync(filePath, JSON.stringify({ port: 99_999_999, pid: process.pid }))
    expect(readLivePort(filePath)).toBeNull()
  })

  it('answers null after the file is removed', () => {
    const filePath = tempPortFilePath()
    writePortFile(filePath, { port: 28_892, pid: process.pid })
    removePortFile(filePath)
    expect(readLivePort(filePath)).toBeNull()
  })
})

describe('resolveEngineUrl', () => {
  it('an explicit override always wins', () => {
    const filePath = tempPortFilePath()
    writePortFile(filePath, { port: 28_892, pid: process.pid })
    expect(resolveEngineUrl('http://127.0.0.1:9000', 18_892, filePath)).toBe('http://127.0.0.1:9000')
  })

  it('a live port file beats the band default', () => {
    const filePath = tempPortFilePath()
    writePortFile(filePath, { port: 28_892, pid: process.pid })
    expect(resolveEngineUrl(undefined, 18_892, filePath)).toBe('http://127.0.0.1:28892')
  })

  it('falls back to the band engine port when the file is absent or stale', () => {
    const filePath = tempPortFilePath()
    expect(resolveEngineUrl(undefined, 18_892, filePath)).toBe('http://127.0.0.1:18892')

    writePortFile(filePath, { port: 28_892, pid: 2_147_483_647 })
    expect(resolveEngineUrl(undefined, 18_892, filePath)).toBe('http://127.0.0.1:18892')
  })
})
