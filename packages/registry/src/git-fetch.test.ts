// The git home against a REAL local fixture repo (no network): ref→sha
// resolution across branch / tag / full-sha / HEAD, and the injection walls
// on refs and shas.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { cloneRepoAtPin, resolveRepoRefToSha, GIT_FULL_SHA } from './git-fetch.js'

let fixtureRepo: string
let mainSha: string
let taggedSha: string

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

beforeAll(() => {
  fixtureRepo = mkdtempSync(join(tmpdir(), 'vynel-git-fetch-fixture-'))
  execFileSync('git', ['init', '--initial-branch=main', fixtureRepo], { encoding: 'utf8' })
  gitIn(fixtureRepo, ['config', 'user.email', 'test@test'])
  gitIn(fixtureRepo, ['config', 'user.name', 'test'])

  writeFileSync(join(fixtureRepo, 'first.txt'), 'first', 'utf8')
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'first'])
  taggedSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])
  gitIn(fixtureRepo, ['tag', '-a', 'v1.0.0', '-m', 'release'])

  writeFileSync(join(fixtureRepo, 'second.txt'), 'second', 'utf8')
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'second'])
  mainSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
})

describe('resolveRepoRefToSha', () => {
  it('resolves a branch, an annotated tag (peeled), and HEAD', async () => {
    expect(await resolveRepoRefToSha(fixtureRepo, 'main')).toBe(mainSha)
    // The PEELED commit behind the annotated tag — not the tag object.
    expect(await resolveRepoRefToSha(fixtureRepo, 'v1.0.0')).toBe(taggedSha)
    expect(await resolveRepoRefToSha(fixtureRepo, 'HEAD')).toBe(mainSha)
  })

  it('passes a full sha through without touching the remote', async () => {
    const sha = 'a'.repeat(40)
    expect(await resolveRepoRefToSha('/nowhere/no-repo', sha)).toBe(sha)
  })

  it('answers null for a ref the remote does not advertise', async () => {
    expect(await resolveRepoRefToSha(fixtureRepo, 'no-such-branch')).toBeNull()
  })

  it('refuses a ref that could be parsed as a git option', async () => {
    await expect(resolveRepoRefToSha(fixtureRepo, '--upload-pack=evil')).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('cloneRepoAtPin', () => {
  it('checks out exactly the pinned commit, not HEAD', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vynel-clone-pin-'))
    try {
      await cloneRepoAtPin(fixtureRepo, taggedSha, dir)
      expect(await readFile(join(dir, 'first.txt'), 'utf8')).toBe('first')
      // second.txt only exists at main — the pin predates it.
      await expect(readFile(join(dir, 'second.txt'), 'utf8')).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a non-sha pin before running any git', async () => {
    await expect(cloneRepoAtPin(fixtureRepo, 'main', '/tmp/never')).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('GIT_FULL_SHA', () => {
  it('accepts only full lowercase 40-hex', () => {
    expect(GIT_FULL_SHA.test('a'.repeat(40))).toBe(true)
    expect(GIT_FULL_SHA.test('A'.repeat(40))).toBe(false)
    expect(GIT_FULL_SHA.test('a'.repeat(39))).toBe(false)
  })
})
