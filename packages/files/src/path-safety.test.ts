// Tests for path visibility + write-target safety — pure, no fs.

import { describe, expect, it } from 'vitest'
import { assertWritableTarget, isHiddenEntry, isUnderHiddenFolder } from './path-safety.js'

describe('isHiddenEntry', () => {
  it.each([
    ['.git', true],
    ['.vynel', true],
    ['node_modules', true],
    ['.gitignore', true],
    ['.env', true],
    ['notes', false],
    ['README.md', false],
    ['Folder With Spaces', false],
  ] as const)('%s → hidden=%s', (input, expected) => {
    expect(isHiddenEntry(input)).toBe(expected)
  })
})

describe('isUnderHiddenFolder', () => {
  it('returns false for the workspace root', () => {
    expect(isUnderHiddenFolder('')).toBe(false)
  })

  it('returns true when any segment is hidden', () => {
    expect(isUnderHiddenFolder('.vynel/sessions/x.json')).toBe(true)
    expect(isUnderHiddenFolder('node_modules/foo/index.js')).toBe(true)
    expect(isUnderHiddenFolder('a/.git/HEAD')).toBe(true)
    expect(isUnderHiddenFolder('a/.dotted/file.md')).toBe(true)
  })

  it('returns false when no segment is hidden', () => {
    expect(isUnderHiddenFolder('notes/todo.md')).toBe(false)
    expect(isUnderHiddenFolder('a/b/c.md')).toBe(false)
  })
})

describe('assertWritableTarget', () => {
  it('rejects writes to the workspace root itself', () => {
    expect(() => assertWritableTarget('')).toThrow(/workspace root/i)
  })

  it('rejects writes under .vynel/', () => {
    expect(() => assertWritableTarget('.vynel/state.json')).toThrow(
      /reserved by Vynel|not writable/i,
    )
  })

  it('allows writes under any non-reserved path', () => {
    expect(() => assertWritableTarget('notes/todo.md')).not.toThrow()
    // .git/ etc. are HIDDEN by default but not write-protected — the
    // user can still write to them if they're showing hidden entries.
    // Phase 1 product call: only `.vynel/` is Vynel-managed.
    expect(() => assertWritableTarget('.gitignore')).not.toThrow()
    expect(() => assertWritableTarget('node_modules/x/package.json')).not.toThrow()
  })
})
