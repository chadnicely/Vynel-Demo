import { describe, it, expect } from 'vitest'
import { takeCompleteLines } from './ndjson-line-splitter.js'

describe('takeCompleteLines', () => {
  it('returns complete lines and an empty remainder when the buffer ends in a newline', () => {
    expect(takeCompleteLines('a\nb\n')).toEqual({ lines: ['a', 'b'], rest: '' })
  })

  it('carries an incomplete trailing line forward as the remainder', () => {
    expect(takeCompleteLines('a\nb')).toEqual({ lines: ['a'], rest: 'b' })
  })

  it('returns no lines for an empty buffer', () => {
    expect(takeCompleteLines('')).toEqual({ lines: [], rest: '' })
  })

  it('preserves CRLF carriage returns on each line (the parser trims them)', () => {
    expect(takeCompleteLines('a\r\nb\r\n')).toEqual({ lines: ['a\r', 'b\r'], rest: '' })
  })
})
