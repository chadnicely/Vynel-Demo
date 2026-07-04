import { describe, it, expect } from 'vitest'
import { shouldBargeInNow } from './barge-in.js'

describe('shouldBargeInNow', () => {
  it('speaks when there is something to say and no one else is speaking', () => {
    expect(
      shouldBargeInNow({
        hasPendingNotifications: true,
        isUserSpeaking: false,
        isAssistantSpeaking: false,
      }),
    ).toBe(true)
  })

  it('holds while the user is speaking — never interrupt the user', () => {
    expect(
      shouldBargeInNow({
        hasPendingNotifications: true,
        isUserSpeaking: true,
        isAssistantSpeaking: false,
      }),
    ).toBe(false)
  })

  it('holds while the assistant is already speaking — no overlap', () => {
    expect(
      shouldBargeInNow({
        hasPendingNotifications: true,
        isUserSpeaking: false,
        isAssistantSpeaking: true,
      }),
    ).toBe(false)
  })

  it('stays silent when there is nothing pending', () => {
    expect(
      shouldBargeInNow({
        hasPendingNotifications: false,
        isUserSpeaking: false,
        isAssistantSpeaking: false,
      }),
    ).toBe(false)
  })
})
