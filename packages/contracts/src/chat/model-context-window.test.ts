import { describe, it, expect } from 'vitest'
import { resolveContextWindow } from './model-context-window.js'

describe('resolveContextWindow', () => {
  it('returns 1M for Opus 4.6–4.8', () => {
    expect(resolveContextWindow('claude-opus-4-8')).toBe(1_000_000)
    expect(resolveContextWindow('claude-opus-4-7')).toBe(1_000_000)
    expect(resolveContextWindow('claude-opus-4-6')).toBe(1_000_000)
  })

  it('returns 1M for Sonnet 4.6, Fable, and Mythos', () => {
    expect(resolveContextWindow('claude-sonnet-4-6')).toBe(1_000_000)
    expect(resolveContextWindow('claude-fable-5')).toBe(1_000_000)
    expect(resolveContextWindow('claude-mythos-5')).toBe(1_000_000)
  })

  it('returns 1M for whole 5+ generations (Opus 5, Sonnet 5)', () => {
    expect(resolveContextWindow('claude-opus-5')).toBe(1_000_000)
    expect(resolveContextWindow('claude-sonnet-5')).toBe(1_000_000)
    // Legacy ids with a version BEFORE the family never false-match.
    expect(resolveContextWindow('claude-3-5-sonnet-20241022')).toBe(200_000)
  })

  it('returns 200k for Sonnet 4.5, Haiku, and older models', () => {
    expect(resolveContextWindow('claude-sonnet-4-5')).toBe(200_000)
    expect(resolveContextWindow('claude-haiku-4-5')).toBe(200_000)
    expect(resolveContextWindow('claude-3-opus')).toBe(200_000)
  })

  it('falls back to 200k for null, undefined, or an unrecognized model', () => {
    expect(resolveContextWindow(null)).toBe(200_000)
    expect(resolveContextWindow(undefined)).toBe(200_000)
    expect(resolveContextWindow('some-future-model')).toBe(200_000)
  })
})
