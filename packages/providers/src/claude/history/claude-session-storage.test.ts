// Tests for `claude-session-storage` — workspace-path encoding + resilient
// JSONL reading. Real temp files; no mocks (the helper takes absolute paths).
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  encodeWorkspacePathToProjectDirectoryName,
  getClaudeProjectsDirectoryPath,
  readClaudeSessionJsonlRecords,
} from './claude-session-storage.js'

describe('encodeWorkspacePathToProjectDirectoryName', () => {
  it('encodes a Windows path — every non-alphanumeric char becomes a dash', () => {
    expect(encodeWorkspacePathToProjectDirectoryName('E:\\KAFI\\WORKSPACE\\v2\\vynel')).toBe(
      'E--KAFI-WORKSPACE-v2-vynel',
    )
  })

  it('encodes a POSIX path', () => {
    expect(encodeWorkspacePathToProjectDirectoryName('/Users/sam/app')).toBe('-Users-sam-app')
  })

  it('encodes dots and spaces too', () => {
    expect(encodeWorkspacePathToProjectDirectoryName('/Users/sam/.config/my app')).toBe(
      '-Users-sam--config-my-app',
    )
  })
})

describe('getClaudeProjectsDirectoryPath', () => {
  it('resolves to ~/.claude/projects', () => {
    expect(getClaudeProjectsDirectoryPath()).toBe(path.join(os.homedir(), '.claude', 'projects'))
  })
})

describe('readClaudeSessionJsonlRecords', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'vynel-jsonl-'))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('returns an empty array when the file does not exist', async () => {
    const records = await readClaudeSessionJsonlRecords(
      path.join(temporaryDirectory, 'missing.jsonl'),
    )
    expect(records).toEqual([])
  })

  it('parses one record per non-blank line', async () => {
    const jsonlPath = path.join(temporaryDirectory, 'session.jsonl')
    await writeFile(
      jsonlPath,
      ['{"type":"user","n":1}', '', '{"type":"assistant","n":2}', '   ', ''].join('\n'),
      'utf8',
    )
    expect(await readClaudeSessionJsonlRecords(jsonlPath)).toEqual([
      { type: 'user', n: 1 },
      { type: 'assistant', n: 2 },
    ])
  })

  it('skips a malformed line rather than throwing', async () => {
    const jsonlPath = path.join(temporaryDirectory, 'partial.jsonl')
    await writeFile(
      jsonlPath,
      ['{"type":"user","n":1}', '{ this is not json', '{"type":"assistant","n":2}'].join('\n'),
      'utf8',
    )
    expect(await readClaudeSessionJsonlRecords(jsonlPath)).toEqual([
      { type: 'user', n: 1 },
      { type: 'assistant', n: 2 },
    ])
  })
})
