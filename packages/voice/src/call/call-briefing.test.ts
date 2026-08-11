import { describe, expect, it } from 'vitest'
import {
  buildCallDisclosureLine,
  buildCallSessionPurpose,
  buildNoteFlushMessage,
  isNotedSentinel,
} from './call-briefing.js'

describe('isNotedSentinel', () => {
  it('accepts the sentinel with case and terminal punctuation variance', () => {
    expect(isNotedSentinel('noted')).toBe(true)
    expect(isNotedSentinel(' Noted! ')).toBe(true)
    expect(isNotedSentinel('NOTED...')).toBe(true)
  })

  it('errs toward speaking — any substantive tail defeats the sentinel', () => {
    expect(isNotedSentinel('Noted — but flag the deadline')).toBe(false)
    expect(isNotedSentinel('"noted"')).toBe(false)
  })
})

describe('buildNoteFlushMessage', () => {
  it('lists the notes and states the sentinel contract', () => {
    const message = buildNoteFlushMessage(['first point', 'second point'])
    expect(message).toContain('- first point')
    expect(message).toContain('- second point')
    expect(message).toContain("exactly 'noted'")
  })
})

describe('buildCallSessionPurpose', () => {
  it('primes a notetaker with the sentinel contract and spoken-prose rule', () => {
    const purpose = buildCallSessionPurpose({
      label: '9pm standup',
      mode: 'notetaker',
      assistantName: 'Vynel',
      goal: 'capture action items',
    })
    expect(purpose).toContain('live inside the call "9pm standup"')
    expect(purpose).toContain('NOTETAKER')
    expect(purpose).toContain("exactly 'noted'")
    expect(purpose).toContain('SPOKEN ALOUD')
    expect(purpose).toContain('capture action items')
  })

  it('primes a participant without the sentinel contract', () => {
    const purpose = buildCallSessionPurpose({
      label: '1:1 with Sam',
      mode: 'participant',
      assistantName: 'Vynel',
    })
    expect(purpose).toContain('PARTICIPANT')
    expect(purpose).not.toContain("exactly 'noted'")
  })
})

describe('buildCallDisclosureLine', () => {
  it('announces the assistant per mode', () => {
    expect(buildCallDisclosureLine('Vynel', 'notetaker')).toContain('taking notes')
    expect(buildCallDisclosureLine('Vynel', 'participant')).toContain('AI assistant')
  })
})
