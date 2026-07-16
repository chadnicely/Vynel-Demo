import { describe, it, expect } from 'vitest'
import {
  AskQuestionsSchema,
  validateAskAnswers,
  type AskQuestion,
} from './ask-questions.js'

const QUESTIONS: AskQuestion[] = [
  { id: 'name', label: 'What should we call the project?', type: 'text' },
  { id: 'tone', label: 'Pick a tone', type: 'choice', options: ['Friendly', 'Formal'] },
  {
    id: 'channels',
    label: 'Where should it post?',
    type: 'multi-choice',
    options: ['Email', 'Telegram'],
    required: false,
  },
  { id: 'count', label: 'How many issues?', type: 'number', required: false },
  { id: 'confirm', label: 'Start today?', type: 'yes-no', required: false },
]

describe('AskQuestionsSchema', () => {
  it('accepts a valid set and rejects structural violations', () => {
    expect(AskQuestionsSchema.safeParse(QUESTIONS).success).toBe(true)
    // choice without options / options on text / duplicate ids / empty set
    expect(
      AskQuestionsSchema.safeParse([{ id: 'a', label: 'x', type: 'choice' }]).success,
    ).toBe(false)
    expect(
      AskQuestionsSchema.safeParse([{ id: 'a', label: 'x', type: 'text', options: ['y', 'z'] }])
        .success,
    ).toBe(false)
    expect(
      AskQuestionsSchema.safeParse([
        { id: 'a', label: 'x', type: 'text' },
        { id: 'a', label: 'y', type: 'text' },
      ]).success,
    ).toBe(false)
    expect(AskQuestionsSchema.safeParse([]).success).toBe(false)
  })
})

describe('validateAskAnswers', () => {
  it('accepts fitting answers and drops nothing that was given', () => {
    const result = validateAskAnswers(QUESTIONS, {
      name: 'Spring letter',
      tone: 'Friendly',
      channels: ['Email'],
      count: 4,
      confirm: true,
    })
    expect(result).toEqual({
      ok: true,
      answers: {
        name: 'Spring letter',
        tone: 'Friendly',
        channels: ['Email'],
        count: 4,
        confirm: true,
      },
    })
  })

  it('optional questions may be absent; required ones may not', () => {
    expect(validateAskAnswers(QUESTIONS, { name: 'X', tone: 'Formal' })).toEqual({
      ok: true,
      answers: { name: 'X', tone: 'Formal' },
    })
    const missing = validateAskAnswers(QUESTIONS, { tone: 'Formal' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problems.join(' ')).toContain('"name"')
  })

  it('rejects wrong types, off-menu options, and unknown keys', () => {
    const bad = validateAskAnswers(QUESTIONS, {
      name: 'X',
      tone: 'Sarcastic', // not an option
      channels: ['Email', 'Fax'], // Fax off-menu
      count: 'four' as unknown as number, // wrong type
      bogus: 'y', // unknown key
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.problems.join(' ')).toContain('"tone"')
      expect(bad.problems.join(' ')).toContain('"channels"')
      expect(bad.problems.join(' ')).toContain('"count"')
      expect(bad.problems.join(' ')).toContain('"bogus"')
    }
  })

  it('treats empty string / empty list as unanswered', () => {
    const result = validateAskAnswers(QUESTIONS, { name: '', tone: 'Friendly', channels: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join(' ')).toContain('"name"')
  })
})
