// Credit-link URL shaping: `.git` and trailing slashes must strip in the
// right order or `…/repo.git/` keeps its `.git` inside the tree link.

import { describe, it, expect } from 'vitest'
import { deriveRepoSourceUrl, repoDisplayUrl } from './repo-source.js'

const SHA = 'a'.repeat(40)

describe('repoDisplayUrl', () => {
  it('strips a trailing .git', () => {
    expect(repoDisplayUrl('https://github.com/a/b.git')).toBe('https://github.com/a/b')
  })

  it('strips trailing slashes BEFORE .git so `.git/` fully sheds', () => {
    expect(repoDisplayUrl('https://github.com/a/b.git/')).toBe('https://github.com/a/b')
    expect(repoDisplayUrl('https://github.com/a/b/')).toBe('https://github.com/a/b')
  })
})

describe('deriveRepoSourceUrl', () => {
  it('anchors the credit link at the pinned sha, with and without a subpath', () => {
    expect(deriveRepoSourceUrl('https://github.com/a/b.git/', SHA, 'skills/x')).toBe(
      `https://github.com/a/b/tree/${SHA}/skills/x`,
    )
    expect(deriveRepoSourceUrl('https://github.com/a/b', SHA, '')).toBe(
      `https://github.com/a/b/tree/${SHA}`,
    )
  })
})
