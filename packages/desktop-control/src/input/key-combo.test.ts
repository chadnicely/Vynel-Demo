import { describe, it, expect } from 'vitest'
import { parseKeyCombo } from './key-combo.js'

// A stand-in for nut.js's Key enum — only the names the tests exercise.
const Key: Record<string, number> = {
  LeftControl: 29,
  LeftShift: 42,
  LeftAlt: 56,
  LeftSuper: 91,
  Enter: 28,
  Tab: 15,
  Escape: 1,
  Up: 103,
  F5: 63,
  A: 30,
  C: 46,
  T: 20,
  Num1: 2,
}

describe('parseKeyCombo', () => {
  it('resolves a single named key', () => {
    expect(parseKeyCombo('enter', Key)).toEqual([Key.Enter])
    expect(parseKeyCombo('esc', Key)).toEqual([Key.Escape])
    expect(parseKeyCombo('up', Key)).toEqual([Key.Up])
    expect(parseKeyCombo('f5', Key)).toEqual([Key.F5])
  })

  it('resolves single letters and digits', () => {
    expect(parseKeyCombo('a', Key)).toEqual([Key.A])
    expect(parseKeyCombo('1', Key)).toEqual([Key.Num1])
  })

  it('resolves a chord modifiers-first', () => {
    expect(parseKeyCombo('ctrl+c', Key)).toEqual([Key.LeftControl, Key.C])
    expect(parseKeyCombo('ctrl+shift+t', Key)).toEqual([Key.LeftControl, Key.LeftShift, Key.T])
    expect(parseKeyCombo('alt+f5', Key)).toEqual([Key.LeftAlt, Key.F5])
  })

  it('is case- and whitespace-insensitive', () => {
    expect(parseKeyCombo('  CTRL + A ', Key)).toEqual([Key.LeftControl, Key.A])
  })

  it('maps win/super/cmd/meta to the super key', () => {
    expect(parseKeyCombo('win', Key)).toEqual([Key.LeftSuper])
    expect(parseKeyCombo('cmd', Key)).toEqual([Key.LeftSuper])
  })

  it('throws an actionable error on an unknown token or empty spec', () => {
    expect(() => parseKeyCombo('splat', Key)).toThrow(/Unknown key "splat"/)
    expect(() => parseKeyCombo('', Key)).toThrow(/Empty key spec/)
  })
})
