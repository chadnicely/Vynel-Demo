import { describe, it, expect } from 'vitest'
import { redactOneTimeCodes } from './redact-one-time-codes.js'

const REDACTED = '[redacted code]'

describe('redactOneTimeCodes', () => {
  it('redacts a code introduced by a verification keyword', () => {
    const out = redactOneTimeCodes('Your verification code is 458219')
    expect(out).toBe(`Your verification code is ${REDACTED}`)
    expect(out).not.toMatch(/\d/)
  })

  it('redacts a code that precedes the keyword', () => {
    expect(redactOneTimeCodes('847295 is your Slack code')).toBe(`${REDACTED} is your Slack code`)
  })

  it('redacts a bare 6-digit code with no surrounding context', () => {
    expect(redactOneTimeCodes('847295')).toBe(REDACTED)
  })

  it('redacts a letter-prefixed code (Google G-style)', () => {
    expect(redactOneTimeCodes('G-557312 is your Google verification code')).toBe(
      `${REDACTED} is your Google verification code`,
    )
  })

  it('redacts a separated code when code context is present', () => {
    expect(redactOneTimeCodes('Enter the code 458 219 to continue')).toBe(
      `Enter the code ${REDACTED} to continue`,
    )
  })

  it('redacts a 4-digit PIN when introduced as such', () => {
    expect(redactOneTimeCodes('Your PIN is 4821')).toBe(`Your PIN is ${REDACTED}`)
  })

  it('preserves small counts with no code context', () => {
    expect(redactOneTimeCodes('You have 3 new messages')).toBe('You have 3 new messages')
  })

  it('preserves a 5-digit order number with no code context', () => {
    expect(redactOneTimeCodes('Order #12345 has shipped')).toBe('Order #12345 has shipped')
  })

  it('preserves a 4-digit time with no code context', () => {
    expect(redactOneTimeCodes('Standup moved to 1430')).toBe('Standup moved to 1430')
  })

  it('returns an empty string unchanged', () => {
    expect(redactOneTimeCodes('')).toBe('')
  })
})
