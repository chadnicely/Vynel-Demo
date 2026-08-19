import { describe, it, expect } from 'vitest'
import { composeManagerSourceLabel } from './compose-manager-source-label.js'

describe('composeManagerSourceLabel', () => {
  it('composes "persona · workspace" when a manager name is given', () => {
    expect(composeManagerSourceLabel('vynel', 'Mark')).toBe('Mark · vynel')
  })

  it('collapses to the workspace name when the persona is the workspace name (the default)', () => {
    expect(composeManagerSourceLabel('vynel', 'vynel')).toBe('vynel')
  })

  it('falls back to just the workspace name when no manager name (additive)', () => {
    expect(composeManagerSourceLabel('vynel')).toBe('vynel')
    expect(composeManagerSourceLabel('vynel', undefined)).toBe('vynel')
  })
})
