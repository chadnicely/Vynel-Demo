import { describe, expect, it } from 'vitest'
import { toSpokenGist } from './spoken-gist.js'

describe('toSpokenGist', () => {
  it('strips markdown and keeps the first sentence', () => {
    expect(toSpokenGist("It's **1:59 AM** (BST). Get some rest if you can.")).toBe(
      "It's 1:59 AM (BST).",
    )
  })

  it('returns empty for whitespace-only input', () => {
    expect(toSpokenGist('   \n  ')).toBe('')
  })

  it('does not cut a leading list marker down to its number', () => {
    expect(toSpokenGist('1. Ship it. Then rest.')).toBe('Ship it.')
  })

  it('caps a runaway first sentence with an ellipsis', () => {
    const long = `${'word '.repeat(80)}end.`
    const gist = toSpokenGist(long)
    expect(gist.length).toBeLessThanOrEqual(241)
    expect(gist.endsWith('…')).toBe(true)
  })
})
