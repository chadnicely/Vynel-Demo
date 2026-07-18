import { describe, expect, it } from 'vitest'
import { deriveDelegationTaskLabel } from './delegation-task-label.js'

describe('deriveDelegationTaskLabel', () => {
  it('takes the first non-empty line, whitespace-collapsed', () => {
    expect(deriveDelegationTaskLabel('\n\n  Set up   the login page\nThen deploy.')).toBe(
      'Set up the login page',
    )
  })

  it('caps long labels with an ellipsis', () => {
    const label = deriveDelegationTaskLabel('x'.repeat(300))
    expect(label.length).toBeLessThanOrEqual(120)
    expect(label.endsWith('…')).toBe(true)
  })

  it('returns an empty string for whitespace-only text', () => {
    expect(deriveDelegationTaskLabel('  \n  ')).toBe('')
  })
})
