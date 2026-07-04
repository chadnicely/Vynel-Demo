import { describe, it, expect } from 'vitest'
import { SpokenSentenceBuffer } from './sentence-buffer.js'

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
