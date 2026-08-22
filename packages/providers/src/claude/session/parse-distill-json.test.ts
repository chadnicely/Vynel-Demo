// Tests for `parseDistillJson` + the field readers — the one home for
// reading a JSON object out of a distill turn's almost-json reply.

import { describe, expect, it } from 'vitest'
import { parseDistillJson, readList, readString, readStringList } from './parse-distill-json.js'

describe('parseDistillJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseDistillJson('{"a": 1}')).toEqual({ a: 1 })
  })

  it('parses a fenced reply and one wrapped in prose', () => {
    expect(parseDistillJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(parseDistillJson('Here you go:\n{"a": 1}\nHope that helps!')).toEqual({ a: 1 })
  })

  it('keeps nested braces intact (outermost span wins)', () => {
    expect(parseDistillJson('{"a": {"b": 2}}')).toEqual({ a: { b: 2 } })
  })

  it('is null for null, prose without an object, and broken json', () => {
    expect(parseDistillJson(null)).toBeNull()
    expect(parseDistillJson('no object here')).toBeNull()
    expect(parseDistillJson('{"a": ')).toBeNull()
  })
})

describe('readList', () => {
  it('returns the array as-is, and [] for a missing key, a non-array, or a non-object', () => {
    expect(readList({ list: [1, 'a', null] }, 'list')).toEqual([1, 'a', null])
    expect(readList({}, 'list')).toEqual([])
    expect(readList({ list: 'nope' }, 'list')).toEqual([])
    expect(readList(null, 'list')).toEqual([])
  })
})

describe('readStringList', () => {
  it('keeps good lines and drops junk members', () => {
    expect(readStringList({ list: ['a', '  b  ', '', 42, null] }, 'list')).toEqual(['a', 'b'])
  })

  it('is empty for a missing key, a non-array, or a non-object', () => {
    expect(readStringList({}, 'list')).toEqual([])
    expect(readStringList({ list: 'nope' }, 'list')).toEqual([])
    expect(readStringList(null, 'list')).toEqual([])
  })
})

describe('readString', () => {
  it('trims, and is empty for anything that is not a string', () => {
    expect(readString({ s: '  hi  ' }, 's')).toBe('hi')
    expect(readString({ s: 7 }, 's')).toBe('')
    expect(readString(null, 's')).toBe('')
  })
})
