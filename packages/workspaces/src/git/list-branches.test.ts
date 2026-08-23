import { describe, expect, it } from 'vitest'
import { listBranches, parseBranches } from './list-branches.js'
import { makeTestRepository } from './test-repository.js'

describe('parseBranches', () => {
  it('marks the current branch and keeps upstreams, null when untracked', () => {
    const output = 'feature/x\t \t\nmain\t*\torigin/main\n'
    expect(parseBranches(output)).toEqual([
      { name: 'feature/x', isCurrent: false, upstream: null },
      { name: 'main', isCurrent: true, upstream: 'origin/main' },
    ])
  })

  it('reads nothing from an empty repository', () => {
    expect(parseBranches('')).toEqual([])
  })
})

describe('listBranches (real git)', () => {
  it('lists every local branch with the checked-out one marked', async () => {
    const repo = makeTestRepository()
    try {
      repo.git('branch', 'feature/one')
      // A tag sharing the branch's name must not rename the branch.
      repo.git('tag', 'main')
      expect(await listBranches(repo.directory)).toEqual([
        { name: 'feature/one', isCurrent: false, upstream: null },
        { name: 'main', isCurrent: true, upstream: null },
      ])
    } finally {
      repo.dispose()
    }
  })
})
