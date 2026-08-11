import { describe, it, expect } from 'vitest'
import {
  parseEnvFileText,
  applyEnvEntriesToText,
  hasMultilineQuotedValue,
} from './env-file.js'

describe('parseEnvFileText', () => {
  it('parses KEY=VALUE lines, skipping comments and blanks, keeping raw values', () => {
    const text = [
      '# database',
      'DATABASE_URL=postgres://localhost/dev',
      '',
      'export API_KEY = abc123 ',
      'QUOTED="hello world"',
      'not a valid line',
      'EMPTY=',
    ].join('\n')

    expect(parseEnvFileText(text)).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://localhost/dev' },
      { key: 'API_KEY', value: 'abc123' },
      { key: 'QUOTED', value: '"hello world"' }, // raw — quotes are the user's
      { key: 'EMPTY', value: '' },
    ])
  })

  it('last duplicate wins, first-seen order kept', () => {
    expect(parseEnvFileText('A=1\nB=2\nA=3\n')).toEqual([
      { key: 'A', value: '3' },
      { key: 'B', value: '2' },
    ])
  })

  it('returns [] for an empty file', () => {
    expect(parseEnvFileText('')).toEqual([])
  })
})

describe('applyEnvEntriesToText', () => {
  it('updates in place, preserves comments/blanks/export prefixes, appends new keys', () => {
    const text = ['# database', 'DATABASE_URL=old', '', 'export API_KEY=abc', 'GONE=x'].join('\n')
    const merged = applyEnvEntriesToText(text, [
      { key: 'DATABASE_URL', value: 'new' },
      { key: 'API_KEY', value: 'abc' },
      { key: 'ADDED', value: 'fresh' },
    ])
    expect(merged).toBe(
      ['# database', 'DATABASE_URL=new', '', 'export API_KEY=abc', 'ADDED=fresh', ''].join('\n'),
    )
  })

  it('drops removed keys and collapses duplicate lines to the first', () => {
    const merged = applyEnvEntriesToText('A=1\nA=2\nB=3\n', [{ key: 'A', value: '9' }])
    expect(merged).toBe('A=9\n')
  })

  it('round-trips: apply(parse(text)) leaves entry lines unchanged', () => {
    const text = '# note\nA=1\nB="two words"\n'
    const merged = applyEnvEntriesToText(text, parseEnvFileText(text))
    expect(merged).toBe(text)
  })

  it('builds a file from scratch and empties one to nothing', () => {
    expect(applyEnvEntriesToText('', [{ key: 'A', value: '1' }])).toBe('A=1\n')
    expect(applyEnvEntriesToText('A=1\n# kept comment\n', [])).toBe('# kept comment\n')
    expect(applyEnvEntriesToText('A=1\n', [])).toBe('')
  })
})

describe('hasMultilineQuotedValue', () => {
  it('flags a quote opened but not closed on its line (the multi-line idiom)', () => {
    expect(hasMultilineQuotedValue('CERT="-----BEGIN\nabc\n-----END"\n')).toBe(true)
    expect(hasMultilineQuotedValue("NOTE='line1\nline2'\n")).toBe(true)
    expect(hasMultilineQuotedValue('LONE="\n')).toBe(true)
  })

  it('accepts balanced quotes, inner quotes, and plain values', () => {
    expect(hasMultilineQuotedValue('A="hello world"\nB=plain\n')).toBe(false)
    expect(hasMultilineQuotedValue(`C="it's fine"\n# a "quoted" comment\n`)).toBe(false)
    expect(hasMultilineQuotedValue('')).toBe(false)
  })
})
