// The drift check against a REAL local git fixture (no network): a repo with
// two republished skill folders, pinned at commit 1; commit 2 changes one
// folder. Verdicts must name exactly the moved folder, and the up-to-date
// path must short-circuit clean.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkUpstreamAgainstPin } from './upstream-watch.js'

let fixtureRepo: string
let pinSha: string
let headSha: string

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

beforeAll(() => {
  fixtureRepo = mkdtempSync(join(tmpdir(), 'vynel-upstream-fixture-'))
  execFileSync('git', ['init', '--initial-branch=main', fixtureRepo], { encoding: 'utf8' })
  gitIn(fixtureRepo, ['config', 'user.email', 'test@test'])
  gitIn(fixtureRepo, ['config', 'user.name', 'test'])

  mkdirSync(join(fixtureRepo, 'skills', 'canvas-design'), { recursive: true })
  mkdirSync(join(fixtureRepo, 'skills', 'theme-factory'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'skills', 'canvas-design', 'SKILL.md'), 'v1', 'utf8')
  writeFileSync(join(fixtureRepo, 'skills', 'theme-factory', 'SKILL.md'), 'v1', 'utf8')
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'pin'])
  pinSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])

  writeFileSync(join(fixtureRepo, 'skills', 'canvas-design', 'SKILL.md'), 'v2', 'utf8')
  writeFileSync(join(fixtureRepo, 'skills', 'canvas-design', 'theme.css'), 'new', 'utf8')
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'upstream moved canvas-design'])
  headSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
})

describe('checkUpstreamAgainstPin', () => {
  it('reports exactly the moved folder, with its changed files and the re-pin recipe', async () => {
    const report = await checkUpstreamAgainstPin({
      upstream: { repo: fixtureRepo, pinnedSha: pinSha },
      items: [
        { itemId: 'canvas-design', version: '1.0.0' },
        { itemId: 'theme-factory', version: '1.0.0' },
      ],
    })

    expect(report.upToDate).toBe(false)
    expect(report.upstreamHeadSha).toBe(headSha)
    expect(report.movedCount).toBe(1)
    const canvas = report.items.find((i) => i.itemId === 'canvas-design')
    expect(canvas?.changed).toBe(true)
    expect(canvas?.changedFiles.sort()).toEqual([
      'skills/canvas-design/SKILL.md',
      'skills/canvas-design/theme.css',
    ])
    expect(report.items.find((i) => i.itemId === 'theme-factory')?.changed).toBe(false)
    expect(report.repinRecipe).toContain(headSha)
  })

  it('short-circuits clean when the pin IS upstream HEAD', async () => {
    const report = await checkUpstreamAgainstPin({
      upstream: { repo: fixtureRepo, pinnedSha: headSha },
      items: [{ itemId: 'canvas-design', version: '1.0.0' }],
    })
    expect(report.upToDate).toBe(true)
    expect(report.movedCount).toBe(0)
    expect(report.repinRecipe).toBeNull()
  })
})
