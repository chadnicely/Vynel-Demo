import { describe, expect, it } from 'vitest'
import { sha256 } from './content-hash.js'

describe('sha256', () => {
  it('returns a stable 64-char hex digest', () => {
    const hash = sha256('hello world')
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
    expect(hash).toHaveLength(64)
  })

  it('is deterministic — same input yields same hash', () => {
    expect(sha256('abc')).toBe(sha256('abc'))
  })

  it('handles empty string', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
