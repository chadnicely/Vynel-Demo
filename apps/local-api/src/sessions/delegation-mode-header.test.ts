import { describe, expect, it } from 'vitest'
import { parseDelegationModeHeader } from './delegation-mode-header.js'

describe('parseDelegationModeHeader', () => {
  it('parses each valid permission mode', () => {
    expect(parseDelegationModeHeader('ask')).toBe('ask')
    expect(parseDelegationModeHeader('auto')).toBe('auto')
    expect(parseDelegationModeHeader('bypass-with-behavior-gate')).toBe(
      'bypass-with-behavior-gate',
    )
  })

  it('yields undefined for an absent header (the pre-mode default)', () => {
    expect(parseDelegationModeHeader(undefined)).toBeUndefined()
  })

  it('yields undefined for an unknown or malformed value — never throws', () => {
    expect(parseDelegationModeHeader('')).toBeUndefined()
    expect(parseDelegationModeHeader('bypass')).toBeUndefined()
    expect(parseDelegationModeHeader('plan-only')).toBeUndefined()
    expect(parseDelegationModeHeader('ASK')).toBeUndefined()
  })
})
