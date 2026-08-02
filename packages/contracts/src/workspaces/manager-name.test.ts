import { describe, it, expect } from 'vitest'
import { deriveDefaultManagerName, resolveManagerName } from './manager-name.js'

describe('deriveDefaultManagerName', () => {
  it('is deterministic — the same id always yields the same name', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    expect(deriveDefaultManagerName(id)).toBe(deriveDefaultManagerName(id))
  })

  it('returns a non-empty name for any id', () => {
    expect(deriveDefaultManagerName('any-id').length).toBeGreaterThan(0)
    expect(deriveDefaultManagerName('').length).toBeGreaterThan(0)
  })
})

describe('resolveManagerName', () => {
  it('returns the explicit managerName when set', () => {
    expect(resolveManagerName({ id: 'w1', managerName: 'Sarah' })).toBe('Sarah')
  })

  it('falls back to the stable default when managerName is null', () => {
    const id = 'workspace-xyz'
    expect(resolveManagerName({ id, managerName: null })).toBe(deriveDefaultManagerName(id))
  })
})
