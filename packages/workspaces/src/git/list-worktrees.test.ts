import { realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listWorktrees, parseWorktrees } from './list-worktrees.js'
import { makeTestRepository } from './test-repository.js'

describe('parseWorktrees', () => {
  it('reads each block, the first as the main checkout, detached as a null branch', () => {
    const output = [
      'worktree /repo',
      'HEAD aaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.claude/worktrees/feature',
      'HEAD bbbb',
      'branch refs/heads/feature/x',
      '',
      'worktree /repo/.claude/worktrees/spike',
      'HEAD cccc',
      'detached',
      '',
    ].join('\n')
    expect(parseWorktrees(output)).toEqual([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/repo/.claude/worktrees/feature', branch: 'feature/x', isMain: false },
      { path: '/repo/.claude/worktrees/spike', branch: null, isMain: false },
    ])
  })
})

describe('listWorktrees (real git)', () => {
  it('sees the main checkout and a worktree added under .claude/worktrees', async () => {
    const repo = makeTestRepository()
    try {
      const worktree = path.join(repo.directory, '.claude', 'worktrees', 'feature')
      repo.git('worktree', 'add', '-q', worktree, '-b', 'feature/x')
      const listed = await listWorktrees(repo.directory)
      expect(listed).toHaveLength(2)
      expect(listed[0]).toMatchObject({ branch: 'main', isMain: true })
      expect(listed[1]).toMatchObject({ branch: 'feature/x', isMain: false })
      // git prints forward slashes and resolves symlinks (macOS /private/tmp).
      expect(path.normalize(listed[1]!.path)).toBe(path.normalize(realpathSync(worktree)))
    } finally {
      repo.dispose()
    }
  })
})
