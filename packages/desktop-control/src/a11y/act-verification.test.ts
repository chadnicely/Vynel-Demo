import { describe, it, expect } from 'vitest'
import { describeVerification, verifyTypedValue } from './act-verification.js'

describe('verifyTypedValue', () => {
  it('set_value must EQUAL — it replaces the content', () => {
    expect(verifyTypedValue('set_value', 'hello', 'hello')).toMatchObject({ kind: 'confirmed' })
    expect(verifyTypedValue('set_value', 'hello', 'hello world')).toMatchObject({
      kind: 'mismatch',
    })
  })

  it('type_text only has to be CONTAINED — it types into what is already there', () => {
    // Demanding equality here would report a false mismatch every single time
    // the model typed into a non-empty field.
    expect(verifyTypedValue('type_text', 'world', 'hello world')).toMatchObject({
      kind: 'confirmed',
    })
    expect(verifyTypedValue('type_text', 'world', 'hello')).toMatchObject({ kind: 'mismatch' })
  })

  it('ignores surrounding whitespace on a replace', () => {
    expect(verifyTypedValue('set_value', ' hello ', 'hello')).toMatchObject({ kind: 'confirmed' })
  })

  it('says UNVERIFIABLE rather than guessing when the control exposes no value', () => {
    const result = verifyTypedValue('type_text', 'x', null)
    expect(result.kind).toBe('unverifiable')
  })

  it('catches the real-world failure: the keystrokes went somewhere else', () => {
    // Focus moved between resolving the element and typing — the field is
    // untouched, and this is exactly what used to pass for success.
    expect(verifyTypedValue('type_text', 'user@example.com', '')).toMatchObject({
      kind: 'mismatch',
      actual: '',
    })
  })
})

describe('describeVerification', () => {
  it('makes a MISMATCH loud and names the likely causes', () => {
    const text = describeVerification({
      kind: 'mismatch',
      intended: 'hello',
      actual: 'goodbye',
    })
    expect(text).toMatch(/NOT VERIFIED/)
    expect(text).toMatch(/focus may have moved/)
    expect(text).toMatch(/"goodbye"/)
  })

  it('states the confirmed value, so the model can see what it is building on', () => {
    expect(describeVerification({ kind: 'confirmed', actual: 'hello' })).toMatch(/now reads "hello"/)
  })

  it('truncates a value that is a whole document', () => {
    const text = describeVerification({ kind: 'confirmed', actual: 'x'.repeat(500) })
    expect(text.length).toBeLessThan(200)
    expect(text).toContain('…')
  })
})

// A false CONFIRMATION is the dangerous direction — a false mismatch is merely
// loud, but confirming text the keystrokes never delivered is silent and gets
// built upon.
describe('verifyTypedValue — the before-value guard', () => {
  it('will NOT confirm text the field already contained', () => {
    // Autofilled field, a retry after a timeout, the second of two identical
    // batch steps: containment alone says "confirmed" while the keystrokes may
    // have gone anywhere.
    const result = verifyTypedValue('type_text', 'hello', 'hello', 'hello')
    expect(result.kind).toBe('unverifiable')
    expect(result).toMatchObject({ reason: expect.stringContaining('already contained') })
  })

  it('still confirms a genuine addition to a non-empty field', () => {
    expect(verifyTypedValue('type_text', 'world', 'hello world', 'hello')).toMatchObject({
      kind: 'confirmed',
    })
  })

  it('does not treat an unchanged field as a MISMATCH — that is its own false alarm', () => {
    // Correctly re-typing the same text into a field that already had it is a
    // legitimate no-visible-change; calling it failed would be wrong too.
    expect(verifyTypedValue('type_text', 'hi', 'hi', 'hi').kind).not.toBe('mismatch')
  })

  it('leaves set_value alone — it REPLACES, so the prior content is irrelevant', () => {
    expect(verifyTypedValue('set_value', 'hello', 'hello', 'hello')).toMatchObject({
      kind: 'confirmed',
    })
  })

  it('is unaffected when the before-value is unknown', () => {
    expect(verifyTypedValue('type_text', 'x', 'x', null)).toMatchObject({ kind: 'confirmed' })
    expect(verifyTypedValue('type_text', 'x', 'x')).toMatchObject({ kind: 'confirmed' })
  })
})
