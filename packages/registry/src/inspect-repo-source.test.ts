// The publish preview against the same style of local fixture: a folder
// carrying vynel-item.json prefills the form, a bare folder answers with
// the detected entry file, and the URL wall holds.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { inspectRepoSource } from './inspect-repo-source.js'
import { cloneRepoAtPin, resolveRepoRefToSha } from './git-fetch.js'
import type { RepoGitDeps } from './repo-source.js'

const REPO_URL = 'https://github.com/acme/agent-tools'

let fixtureRepo: string
let pinSha: string

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

beforeAll(() => {
  fixtureRepo = mkdtempSync(join(tmpdir(), 'vynel-inspect-repo-fixture-'))
  execFileSync('git', ['init', '--initial-branch=main', fixtureRepo], { encoding: 'utf8' })
  gitIn(fixtureRepo, ['config', 'user.email', 'test@test'])
  gitIn(fixtureRepo, ['config', 'user.name', 'test'])

  mkdirSync(join(fixtureRepo, 'with-manifest'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'with-manifest', 'SKILL.md'), '# skill', 'utf8')
  writeFileSync(
    join(fixtureRepo, 'with-manifest', 'vynel-item.json'),
    JSON.stringify({
      publisher: { id: 'acme', name: 'Acme', tier: 'community' },
      item: { itemId: 'with-manifest', kind: 'skill', displayName: 'With Manifest' },
      version: { version: '1.2.0' },
      unknownKey: 'dropped',
    }),
    'utf8',
  )
  mkdirSync(join(fixtureRepo, 'bare-mcp'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'bare-mcp', 'server-descriptor.json'), '{}', 'utf8')
  mkdirSync(join(fixtureRepo, 'broken'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'broken', 'vynel-item.json'), '{not json', 'utf8')
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'pin'])
  pinSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
})

const fixtureDeps: RepoGitDeps = {
  resolveRefToSha: (_repo, ref) => resolveRepoRefToSha(fixtureRepo, ref),
  cloneAtPin: (_repo, sha, dir) => cloneRepoAtPin(fixtureRepo, sha, dir),
}

describe('inspectRepoSource', () => {
  it('returns the lenient manifest prefill plus the entry detection', async () => {
    const result = await inspectRepoSource(
      { url: REPO_URL, ref: 'main', subpath: 'with-manifest' },
      fixtureDeps,
    )
    expect(result.resolvedSha).toBe(pinSha)
    expect(result.sourceUrl).toBe(`${REPO_URL}/tree/${pinSha}/with-manifest`)
    expect(result.manifest).toEqual({
      publisher: { id: 'acme', name: 'Acme', tier: 'community' },
      item: { itemId: 'with-manifest', kind: 'skill', displayName: 'With Manifest' },
      version: { version: '1.2.0' },
    })
    expect(result.detectedKind).toBe('skill')
    expect(result.entryFile).toBe('SKILL.md')
  })

  it('detects the kind from the entry file when there is no manifest', async () => {
    const result = await inspectRepoSource(
      { url: REPO_URL, ref: pinSha, subpath: 'bare-mcp' },
      fixtureDeps,
    )
    expect(result.manifest).toBeNull()
    expect(result.detectedKind).toBe('mcp')
    expect(result.entryFile).toBe('server-descriptor.json')
  })

  it('surfaces a broken vynel-item.json as an actionable validation error', async () => {
    await expect(
      inspectRepoSource({ url: REPO_URL, ref: 'main', subpath: 'broken' }, fixtureDeps),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('vynel-item.json'),
    })
  })

  it('holds the URL wall', async () => {
    await expect(
      inspectRepoSource({ url: 'file:///etc', subpath: '' }, fixtureDeps),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
