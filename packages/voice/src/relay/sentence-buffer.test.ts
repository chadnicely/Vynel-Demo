import { describe, it, expect } from 'vitest'
import {
  CLAUSE_CUT_CHARS,
  FIRST_CHUNK_CLAUSE_CUT_CHARS,
  SpokenSentenceBuffer,
} from './sentence-buffer.js'

describe('SpokenSentenceBuffer', () => {
  it('emits a complete sentence once its boundary arrives, keeping the partial tail buffered', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('Hello world. How')).toEqual(['Hello world.'])
    expect(buffer.push(' are you')).toEqual([]) // no boundary yet — stays buffered
    expect(buffer.push('?')).toEqual([]) // terminator with no trailing space yet
    expect(buffer.push(' ')).toEqual(['How are you?'])
  })

  it('splits multiple sentences in one delta, in order', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('One. Two! Three? ')).toEqual(['One.', 'Two!', 'Three?'])
  })

  it('treats a newline as a boundary', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('Line one\nLine two')).toEqual(['Line one'])
    expect(buffer.flush()).toEqual(['Line two'])
  })

  it('does not split a decimal (period followed by a digit)', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('Pi is 3.14 exactly. Next')).toEqual(['Pi is 3.14 exactly.'])
  })

  it('flush emits a trailing sentence that never got a terminator', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('No terminator here')).toEqual([])
    expect(buffer.flush()).toEqual(['No terminator here'])
    expect(buffer.flush()).toEqual([]) // nothing left
  })

  it('collapses runs of terminators into one boundary', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('Wow!!! Really')).toEqual(['Wow!!!'])
  })
})

describe('SpokenSentenceBuffer — the clause-level cut (VR4)', () => {
  const LONG_SENTENCE =
    'I checked your schedules, and you have three meetings tomorrow morning, ' + // 72
    'the first one is at nine with the design team, then a quick sync with Sam, ' + // +75 = 147
    'and the last one is lunch with the investors at one.' // +52 = 199

  it('cuts a long sentence at clause breaks — the first chunk tight, the rest at the cut length', () => {
    const buffer = new SpokenSentenceBuffer()
    const chunks = [...buffer.push(LONG_SENTENCE), ...buffer.flush()]
    expect(chunks).toEqual([
      'I checked your schedules,',
      'and you have three meetings tomorrow morning, the first one is at nine with the design team,',
      'then a quick sync with Sam, and the last one is lunch with the investors at one.',
    ])
    expect(chunks[0]!.length).toBeLessThanOrEqual(FIRST_CHUNK_CLAUSE_CUT_CHARS)
    expect(chunks[1]!.length).toBeLessThanOrEqual(CLAUSE_CUT_CHARS)
  })

  it('only the FIRST chunk cuts tight — the same sentence later in the turn stays whole', () => {
    const sentence = 'I checked the calendar for tomorrow, and the morning is completely free. '
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push(sentence)).toEqual([
      'I checked the calendar for tomorrow,',
      'and the morning is completely free.',
    ])
    expect(buffer.push(sentence)).toEqual([
      'I checked the calendar for tomorrow, and the morning is completely free.',
    ])
  })

  it('produces the same chunks token by token as in one push', () => {
    const streamed = new SpokenSentenceBuffer()
    const chunks: string[] = []
    for (const token of LONG_SENTENCE.match(/\S+\s*/g)!) chunks.push(...streamed.push(token))
    chunks.push(...streamed.flush())
    const atOnce = new SpokenSentenceBuffer()
    expect(chunks).toEqual([...atOnce.push(LONG_SENTENCE), ...atOnce.flush()])
  })

  it('a short sentence is never clause-cut — a comma alone is not a boundary', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('Yes, I can do that, no problem. ')).toEqual(['Yes, I can do that, no problem.'])
  })

  it('with no clause break within the cut length, the first one after it is the cut', () => {
    const head = 'a'.repeat(130)
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push(`${head} and then, the rest follows here`)).toEqual([`${head} and then,`])
    expect(buffer.flush()).toEqual(['the rest follows here'])
  })

  it('never cuts mid-word: a long run with no clause break waits for its sentence end', () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ') // > 120 chars, no break
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push(words)).toEqual([])
    expect(buffer.push('. Next')).toEqual([`${words}.`])
  })

  it('a comma inside a number is not a clause break', () => {
    const buffer = new SpokenSentenceBuffer()
    const text = `The budget is 1,250,000 dollars across ${'many '.repeat(22)}lines, with more`
    const [first] = buffer.push(text)
    expect(first).toContain('1,250,000')
  })

  it('treats a spaced dash and an em dash as clause breaks', () => {
    const buffer = new SpokenSentenceBuffer()
    const head = 'b'.repeat(118)
    expect(buffer.push(`${head} — then the tail continues for a while`)).toEqual([`${head} —`])
    const other = new SpokenSentenceBuffer()
    expect(other.push(`${head} - then the tail continues for a while`)).toEqual([`${head} -`])
  })

  it('flush clause-cuts a long tail too', () => {
    const buffer = new SpokenSentenceBuffer()
    const chunks = [...buffer.push(LONG_SENTENCE.slice(0, -1)), ...buffer.flush()] // no terminator at all
    expect(chunks).toHaveLength(3)
    expect(chunks.join(' ')).toBe(LONG_SENTENCE.slice(0, -1))
  })

  it('a closing quote or emphasis marker after the terminator does not hide the boundary', () => {
    const buffer = new SpokenSentenceBuffer()
    expect(buffer.push('He said "done." Then **Next.** And')).toEqual(['He said "done."', 'Then **Next.**'])
  })
})
