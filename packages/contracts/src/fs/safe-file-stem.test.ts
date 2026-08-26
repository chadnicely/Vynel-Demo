import { describe, it, expect } from 'vitest'
import { isSafeFileStem } from './safe-file-stem.js'

describe('isSafeFileStem', () => {
  it('accepts what a person would name a file', () => {
    for (const stem of ['git-hygiene', 'Team Rules', 'règles', 'a.b', 'x']) {
      expect(isSafeFileStem(stem)).toBe(true)
    }
  })

  it('rejects what could leave the folder, hide from a listing, or never land on Windows', () => {
    for (const stem of [
      '',
      '.hidden',
      '../escape',
      'a/b',
      'a\\b',
      ' padded',
      'x'.repeat(121),
      'foo:bar',
      'what?',
      'a<b',
      'a|b',
      'x*',
      'say "hi"',
      'tab\there',
      'nul',
      'CON',
      'com1.old',
    ]) {
      expect(isSafeFileStem(stem)).toBe(false)
    }
  })
})
