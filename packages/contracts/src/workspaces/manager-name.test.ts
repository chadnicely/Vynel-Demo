import { describe, it, expect } from 'vitest'
import {
  formatManagerLabel,
  hasDistinctManagerName,
  resolveManagerName,
} from './manager-name.js'

describe('resolveManagerName', () => {
  it('returns the explicit managerName when set', () => {
    expect(resolveManagerName({ name: 'vynel', managerName: 'Sarah' })).toBe('Sarah')
  })

  it('falls back to the workspace name — the default persona IS the workspace', () => {
    expect(resolveManagerName({ name: 'Bookkeeping', managerName: null })).toBe('Bookkeeping')
  })
})

describe('hasDistinctManagerName', () => {
  it('is false for the default (null or the workspace name itself, any casing)', () => {
    expect(hasDistinctManagerName({ name: 'vynel', managerName: null })).toBe(false)
    expect(hasDistinctManagerName({ name: 'vynel', managerName: 'vynel' })).toBe(false)
    expect(hasDistinctManagerName({ name: 'vynel', managerName: 'Vynel ' })).toBe(false)
  })

  it('is true once the persona has been renamed', () => {
    expect(hasDistinctManagerName({ name: 'vynel', managerName: 'Mark' })).toBe(true)
  })
})

describe('formatManagerLabel', () => {
  it('reads "persona · workspace" for a distinct persona', () => {
    expect(formatManagerLabel('Mark', 'vynel')).toBe('Mark · vynel')
  })

  it('collapses to the workspace alone when the persona is the workspace name', () => {
    expect(formatManagerLabel('vynel', 'vynel')).toBe('vynel')
    expect(formatManagerLabel('Vynel', 'vynel')).toBe('vynel')
  })
})
