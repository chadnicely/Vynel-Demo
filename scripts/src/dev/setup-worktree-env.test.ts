import { describe, expect, it } from 'vitest'
import { sep } from 'node:path'
import {
  findFreeBand,
  findMainRootFor,
  readPortBaseFromEnvText,
  withPortBase,
} from './setup-worktree-env.js'

describe('readPortBaseFromEnvText', () => {
  it('reads an assignment and falls back to the canonical base', () => {
    expect(readPortBaseFromEnvText('VYNEL_PORT_BASE=28890\n')).toBe(28_890)
    expect(readPortBaseFromEnvText('  VYNEL_PORT_BASE = 28900  \n')).toBe(28_900)
    expect(readPortBaseFromEnvText('PORT=18892\n')).toBe(18_890)
    expect(readPortBaseFromEnvText('# VYNEL_PORT_BASE=28890\n')).toBe(18_890)
  })
})

describe('withPortBase', () => {
  it('replaces an existing assignment in place', () => {
    const rewritten = withPortBase('LOG_LEVEL=info\nVYNEL_PORT_BASE=28890\nPORT=1\n', 28_900)
    expect(rewritten).toBe('LOG_LEVEL=info\nVYNEL_PORT_BASE=28900\nPORT=1\n')
  })

  it('uncomments and claims a commented-out assignment', () => {
    const rewritten = withPortBase('# VYNEL_PORT_BASE=18890\n', 28_900)
    expect(rewritten).toBe('VYNEL_PORT_BASE=28900\n')
  })

  it('appends when no assignment exists, keeping the source text intact', () => {
    const rewritten = withPortBase('LOG_LEVEL=info\n', 28_900)
    expect(rewritten).toContain('LOG_LEVEL=info\n')
    expect(rewritten).toMatch(/VYNEL_PORT_BASE=28900\n$/)
    expect(readPortBaseFromEnvText(rewritten)).toBe(28_900)
  })
})

describe('findFreeBand', () => {
  it('skips claimed bands without probing them', async () => {
    const probed: number[] = []
    const band = await findFreeBand(new Set([18_900, 18_910]), (candidate) => {
      probed.push(candidate)
      return Promise.resolve(true)
    })
    expect(band).toBe(18_920)
    expect(probed).toEqual([18_920])
  })

  it('skips occupied bands until the probe reports free', async () => {
    const band = await findFreeBand(new Set(), (candidate) => Promise.resolve(candidate >= 18_920))
    expect(band).toBe(18_920)
  })
})

describe('findMainRootFor', () => {
  it('resolves a worktree back to its main checkout', () => {
    const main = ['', 'repos', 'vynel'].join(sep)
    const worktree = [main, '.claude', 'worktrees', 'voice-arc'].join(sep)
    expect(findMainRootFor(worktree)).toBe(main)
  })

  it('answers null for the main checkout itself', () => {
    expect(findMainRootFor(['', 'repos', 'vynel'].join(sep))).toBeNull()
  })
})
