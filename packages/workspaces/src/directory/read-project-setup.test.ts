// Real folders — the point of this op is that it ANSWERS from what is on
// disk, so every fixture is a real .env / package.json / git repo.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ValidationError } from '@vynel/errors'
import { readProjectSetup, suggestRepositoryName } from './read-project-setup.js'

function tempDir(name = 'vynel-setup-'): string {
  return mkdtempSync(path.join(os.tmpdir(), name))
}

function initRepo(dir: string, remote?: string) {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', windowsHide: true })
  git('init', '--initial-branch=main')
  if (remote) git('remote', 'add', 'origin', remote)
}

describe('readProjectSetup', () => {
  it('a pushing repo answers the repository question outright', async () => {
    const dir = tempDir()
    initRepo(dir, 'https://github.com/chadnicely/table.git')

    const setup = await readProjectSetup(dir)
    expect(setup.repository).toEqual({
      kind: 'remote',
      url: 'https://github.com/chadnicely/table.git',
    })
  })

  it('a repo with no remote proposes a name from the folder', async () => {
    const dir = path.join(tempDir(), 'Front of House')
    execFileSync('git', ['init', '--initial-branch=main', dir], {
      stdio: 'pipe',
      windowsHide: true,
    })
    const setup = await readProjectSetup(dir)
    expect(setup.repository).toEqual({
      kind: 'local-only',
      suggestedName: 'front-of-house',
    })
  })

  it('no git at all still proposes what we would create', async () => {
    const dir = tempDir()
    const setup = await readProjectSetup(dir)
    expect(setup.repository.kind).toBe('none')
    // Main's GitFacts is a tagged union — 'no-git' is the shape, not a boolean.
    expect(setup.git.kind).not.toBe('repository')
  })

  it('an existing .env is the answer — key names only, never values', async () => {
    const dir = tempDir()
    writeFileSync(
      path.join(dir, '.env'),
      'DATABASE_URL=postgres://secret\n# note\nSTRIPE_KEY=sk_live_dont_leak\n',
    )
    const setup = await readProjectSetup(dir)
    expect(setup.env).toEqual({
      kind: 'present',
      keyNames: ['DATABASE_URL', 'STRIPE_KEY'],
    })
    expect(JSON.stringify(setup)).not.toContain('sk_live_dont_leak')
  })

  it('falls back to a template, then to not-needed', async () => {
    const withTemplate = tempDir()
    writeFileSync(path.join(withTemplate, '.env.example'), 'API_URL=\nPORT=\n')
    expect((await readProjectSetup(withTemplate)).env).toEqual({
      kind: 'from-example',
      keyNames: ['API_URL', 'PORT'],
    })

    expect((await readProjectSetup(tempDir())).env).toEqual({ kind: 'not-needed' })
  })

  it('reads the database off the dependencies and flags a local one', async () => {
    const dir = tempDir()
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'better-sqlite3': '9.0.0' } }),
    )
    const setup = await readProjectSetup(dir)
    expect(setup.database).toBe('SQLite')
    expect(setup.databaseIsLocal).toBe(true)

    const remote = tempDir()
    writeFileSync(
      path.join(remote, 'package.json'),
      JSON.stringify({ dependencies: { pg: '8.0.0' } }),
    )
    const remoteSetup = await readProjectSetup(remote)
    expect(remoteSetup.database).toBe('Postgres')
    expect(remoteSetup.databaseIsLocal).toBe(false)
  })

  it('rejects a path that is gone', async () => {
    await expect(
      readProjectSetup(path.join(os.tmpdir(), 'vynel-nope-xyz')),
    ).rejects.toThrow(ValidationError)
  })
})

describe('suggestRepositoryName', () => {
  it('slugs the folder name', () => {
    expect(suggestRepositoryName('/x/Nicely Community')).toBe('nicely-community')
    expect(suggestRepositoryName('/x/table')).toBe('table')
  })
})
