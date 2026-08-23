import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGitStatus, readGitFacts, redactCredentials } from './read-git-facts.js'
import { makeTestRepository } from './test-repository.js'

describe('parseGitStatus', () => {
  it('reads branch, upstream, ahead/behind and the change counts from porcelain v2', () => {
    const status = [
      '# branch.oid 1234abcd',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc abc src/a.ts',
      '1 M. N... 100644 100644 100644 abc abc src/b.ts',
      '2 R. N... 100644 100644 100644 abc abc R100 src/c.ts\tsrc/old.ts',
      'u UU N... 100644 100644 100644 100644 abc abc abc src/conflict.ts',
      '? notes.txt',
      '? photos/',
      '',
    ].join('\n')
    expect(parseGitStatus(status)).toEqual({
      kind: 'repository',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      changedCount: 4,
      untrackedCount: 2,
    })
  })

  it('says detached plainly and leaves ahead/behind unknown without an upstream', () => {
    const facts = parseGitStatus('# branch.oid 1234abcd\n# branch.head (detached)\n')
    expect(facts.branch).toBeNull()
    expect(facts.upstream).toBeNull()
    expect(facts.ahead).toBeNull()
    expect(facts.behind).toBeNull()
  })
})

describe('readGitFacts (real git)', () => {
  it('answers a repository with its branch, a clean tree and no remote', async () => {
    const repo = makeTestRepository()
    try {
      expect(await readGitFacts(repo.directory)).toEqual({
        kind: 'repository',
        branch: 'main',
        upstream: null,
        ahead: null,
        behind: null,
        changedCount: 0,
        untrackedCount: 0,
        remoteUrl: null,
      })
    } finally {
      repo.dispose()
    }
  })

  it('counts changed and untracked files and reports the origin address', async () => {
    const repo = makeTestRepository()
    try {
      writeFileSync(path.join(repo.directory, 'README.md'), '# changed\n')
      writeFileSync(path.join(repo.directory, 'notes.txt'), 'new\n')
      repo.git('remote', 'add', 'origin', 'https://github.com/acme/test.git')
      const facts = await readGitFacts(repo.directory)
      expect(facts).toMatchObject({
        kind: 'repository',
        changedCount: 1,
        untrackedCount: 1,
        remoteUrl: 'https://github.com/acme/test.git',
      })
    } finally {
      repo.dispose()
    }
  })

  it('never echoes a credential pasted into the origin address', async () => {
    const repo = makeTestRepository()
    try {
      repo.git('remote', 'add', 'origin', 'https://user:secret@github.com/acme/test.git')
      expect(await readGitFacts(repo.directory)).toMatchObject({
        remoteUrl: 'https://github.com/acme/test.git',
      })
    } finally {
      repo.dispose()
    }
    expect(redactCredentials('https://ghp_abc123@github.com/a/b.git')).toBe(
      'https://github.com/a/b.git',
    )
    expect(redactCredentials('git@github.com:a/b.git')).toBe('git@github.com:a/b.git')
    expect(redactCredentials('ssh://git@github.com/a/b.git')).toBe('ssh://github.com/a/b.git')
  })

  it('reads a repository with no commits yet: branch known, nothing to count', async () => {
    const repo = makeTestRepository({ commit: false })
    try {
      expect(await readGitFacts(repo.directory)).toMatchObject({
        kind: 'repository',
        branch: 'main',
        ahead: null,
        behind: null,
        changedCount: 0,
        untrackedCount: 1,
      })
    } finally {
      repo.dispose()
    }
  })

  it('calls a plain folder not-a-repository and a vanished folder folder-missing', async () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'vynel-plain-'))
    try {
      expect(await readGitFacts(plain)).toEqual({ kind: 'not-a-repository' })
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
    expect(await readGitFacts(path.join(plain, 'gone'))).toEqual({ kind: 'folder-missing' })
  })

  it('says no-git when the binary is missing, unreadable with the reason otherwise', async () => {
    const repo = makeTestRepository()
    try {
      const missing = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
      expect(await readGitFacts(repo.directory, async () => Promise.reject(missing))).toEqual({
        kind: 'no-git',
      })
      const dubious = Object.assign(new Error('Command failed: git status'), {
        stderr: 'fatal: detected dubious ownership in repository\n',
      })
      expect(await readGitFacts(repo.directory, async () => Promise.reject(dubious))).toEqual({
        kind: 'unreadable',
        reason: 'detected dubious ownership in repository',
      })
    } finally {
      repo.dispose()
    }
  })
})
