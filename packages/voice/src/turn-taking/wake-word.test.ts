import { describe, expect, it } from 'vitest'
import { detectWakeWord, stripWakePrefix } from './wake-word.js'

describe('detectWakeWord', () => {
  it('detects the wake phrase and returns the command after it', () => {
    expect(detectWakeWord('hey vynel what time is it')).toEqual({
      detected: true,
      command: 'what time is it',
    })
  })

  it('handles punctuation + casing and preserves the command casing', () => {
    expect(detectWakeWord('Hey, Vynel. How many workspaces do I have?')).toEqual({
      detected: true,
      command: 'How many workspaces do I have?',
    })
  })

  it('detects the wake phrase alone (no command)', () => {
    expect(detectWakeWord('hey vynel')).toEqual({ detected: true, command: '' })
    expect(detectWakeWord('Hey Vynel!')).toEqual({ detected: true, command: '' })
  })

  it('tolerates common Whisper mishears of the name', () => {
    expect(detectWakeWord('hey vinel whats up').detected).toBe(true)
    expect(detectWakeWord('hi vynell remind me to call mom').command).toBe('remind me to call mom')
    expect(detectWakeWord('hey vinyl remind me to call mom').command).toBe('remind me to call mom')
  })

  it('wakes on the live "hey fine" mishear tiny STT returns for "hey vynel"', () => {
    expect(detectWakeWord('Hey, fine, hello')).toEqual({ detected: true, command: 'hello' })
  })

  it('detects "hey claude" (the assistant display name) and its mishears', () => {
    expect(detectWakeWord('hey claude what time is it')).toEqual({
      detected: true,
      command: 'what time is it',
    })
    expect(detectWakeWord('Hey Claude!')).toEqual({ detected: true, command: '' })
    expect(detectWakeWord('hey cloud remind me to call mom').command).toBe('remind me to call mom')
    expect(detectWakeWord('hi clawed whats up').detected).toBe(true)
  })

  // The retired name is DELIBERATE residue, not a leftover: the P3 rename moved
  // every surface off it, but dropping it from the ear is a behaviour change —
  // an early user who still says it would simply stop being heard — so it waits
  // on Kafi's product call. Pinned so nobody "tidies" it away by accident, and
  // so removing it is a visible decision (delete this case with the spellings).
  it('still hears the retired name, kept until the product call lands', () => {
    expect(detectWakeWord('hey jarvis what time is it')).toEqual({
      detected: true,
      command: 'what time is it',
    })
    expect(detectWakeWord('hey jervis').detected).toBe(true)
  })

  // The demo-film opener (Chad, 2026-08-28): "What's up Pacino" wakes the
  // routine on camera. The greeting is as strict as "hey" — a name must
  // follow — so ordinary "what's up …" speech stays inert.
  it('detects "what\'s up pacino" and its STT spellings', () => {
    expect(detectWakeWord("What's up Pacino")).toEqual({ detected: true, command: '' })
    expect(detectWakeWord("what's up, pacino, run the update")).toEqual({
      detected: true,
      command: 'run the update',
    })
    expect(detectWakeWord('whats up pachino').detected).toBe(true)
    expect(detectWakeWord('wassup pacino').detected).toBe(true)
    expect(detectWakeWord('sup pacino').detected).toBe(true)
    // The cappuccino-class garbles tiny STT returns for an Italian surname.
    expect(detectWakeWord("what's up puccino").detected).toBe(true)
    expect(detectWakeWord("what's up casino").detected).toBe(true)
  })

  it('a "what\'s up" with no wake name after it stays inert', () => {
    expect(detectWakeWord("what's up with the build").detected).toBe(false)
    expect(detectWakeWord('whats up everybody').detected).toBe(false)
  })

  // The two halves never cross: the demo greeting beside a CLASSIC name is
  // overheard dialogue ("What's up?" "Fine." with STT-stripped punctuation),
  // and a classic greeting beside the common-word demo garble is TV audio.
  it("keeps the demo greetings and the classic names apart", () => {
    expect(detectWakeWord('whats up fine').detected).toBe(false)
    expect(detectWakeWord("what's up claude").detected).toBe(false)
    expect(detectWakeWord('hey casino what time is it').detected).toBe(false)
    // “hey pacino” NOW wakes (Chad, 2026-08-30): he says the name first on
    // camera, and the take was lost every time. Only the “casino” garble stays
    // out of this pairing — it is an ordinary word a television says.
    expect(detectWakeWord('hey pacino').detected).toBe(true)
  })

  // THE SECOND TRIGGER (Chad, 2026-08-28): the wake phrase gets the evening
  // update, then he ASKS for the software and the second half plays. The
  // question wakes on its own and arrives whole, so the surface can tell which
  // follow-up was asked.
  it('wakes on the demo follow-up questions and hands the whole question over', () => {
    expect(detectWakeWord("How's our software doing?")).toEqual({
      detected: true,
      command: "How's our software doing?",
    })
    expect(detectWakeWord('hows the dev team doing').detected).toBe(true)
    expect(detectWakeWord('give me the dev updates').detected).toBe(true)
    expect(detectWakeWord("what's the development team updates").detected).toBe(true)
    expect(detectWakeWord("what's everyone been working on").detected).toBe(true)
  })

  it('keeps the follow-ups long enough not to fire on ordinary talk', () => {
    expect(detectWakeWord('how are you').detected).toBe(false)
    expect(detectWakeWord('the software is fine').detected).toBe(false)
    expect(detectWakeWord('how did the dev call go').detected).toBe(false)
    expect(detectWakeWord('our software team is great').detected).toBe(false)
  })

  it('does not fire without the wake phrase', () => {
    expect(detectWakeWord('what time is it')).toEqual({ detected: false, command: '' })
    expect(detectWakeWord('hey there how are you')).toEqual({ detected: false, command: '' })
    expect(detectWakeWord('')).toEqual({ detected: false, command: '' })
  })

  it('only matches the wake phrase at the START (not mid-sentence)', () => {
    expect(detectWakeWord('tell vynel hello').detected).toBe(false)
  })
})

describe('stripWakePrefix', () => {
  it('strips a leading bare name residue', () => {
    expect(stripWakePrefix('vynel what time is it')).toBe('what time is it')
  })

  it('strips a leading greeting-plus-name residue', () => {
    expect(stripWakePrefix('hey vynel remind me to call mom')).toBe('remind me to call mom')
  })

  it('leaves a clean command untouched', () => {
    expect(stripWakePrefix('what time is it')).toBe('what time is it')
  })
})

// The CUSTOM wake name (Kafi, 2026-08-28): the user's own name wakes the
// daemon BESIDE the built-ins, matched loosely — the same tolerance class the
// built-ins get from their hand-tuned garble lists.
describe('detectWakeWord — custom wake names', () => {
  const options = { extraWakeNames: ['friday'] }

  it('wakes on the custom name and carries the command', () => {
    expect(detectWakeWord('Hey Friday, what time is it?', options)).toEqual({
      detected: true,
      command: 'what time is it?',
    })
  })

  it('tolerates a mishearing within the edit-distance budget', () => {
    // "friday" → "fridey" (1 slip, length 6 allows 2).
    expect(detectWakeWord('hey fridey open the news', options).detected).toBe(true)
    // Too far — "fright" is 3 edits away.
    expect(detectWakeWord('hey fright open the news', options).detected).toBe(false)
  })

  it('a short name gets NO fuzz — "Max" must not answer every "hey man" in the room', () => {
    const max = { extraWakeNames: ['max'] }
    expect(detectWakeWord('hey max what time is it', max).detected).toBe(true)
    // Distance 1, but the ≤3-letter floor is exact-only: everyday speech
    // (and the TV) is full of the distance-1 ball around a short name.
    expect(detectWakeWord('hey man what time is it', max).detected).toBe(false)
    expect(detectWakeWord('hey mad about that', max).detected).toBe(false)
  })

  it('keeps the built-ins working beside a custom name', () => {
    expect(detectWakeWord('hey vynel status', options).detected).toBe(true)
    expect(detectWakeWord('hey claude status', options).detected).toBe(true)
  })

  it('never wakes on the custom name without a greeting, and never with none configured', () => {
    expect(detectWakeWord('friday what time is it', options).detected).toBe(false)
    expect(detectWakeWord('hey friday what time is it').detected).toBe(false)
  })
})

// THE THREE EXCHANGES he actually says to camera (Chad, 2026-08-30). Each one
// has to wake on its own: the film stops between them, so a phrase that does
// not match leaves him talking to a black screen.
describe('the filmed conversation', () => {
  it('opens on the demo wake', () => {
    expect(detectWakeWord("What's up Pacino").detected).toBe(true)
    expect(detectWakeWord('Wassup Pacino').detected).toBe(true)
  })

  it('asks for the software on the follow-up', () => {
    expect(detectWakeWord("How's our software doing?").detected).toBe(true)
    expect(detectWakeWord("What's the dev update?").detected).toBe(true)
  })

  it('signs off with thanks AND the name', () => {
    expect(detectWakeWord('Thanks Pacino!').detected).toBe(true)
    expect(detectWakeWord('Thank you Pacino').detected).toBe(true)
    expect(detectWakeWord('Thanks Pacino').command).toBe('Thanks Pacino')
  })

  it('does not sign off on a bare thanks near the microphone', () => {
    // Said to people on a set constantly; the name is what makes it a cue.
    expect(detectWakeWord('thanks').detected).toBe(false)
    expect(detectWakeWord('thanks so much for that').detected).toBe(false)
    expect(detectWakeWord('thank you very much').detected).toBe(false)
  })
})

describe('the name first, the way he actually says it', () => {
  it('wakes on "Hey Pacino" as well as "What\u2019s up Pacino"', () => {
    expect(detectWakeWord('Hey Pacino, what\u2019s up?').detected).toBe(true)
    expect(detectWakeWord('Hi Pacino').detected).toBe(true)
    expect(detectWakeWord("What's up Pacino").detected).toBe(true)
  })

  it('keeps the command after the name', () => {
    expect(detectWakeWord('Hey Pacino, how are we doing?').command).toBe(
      'how are we doing?',
    )
  })

  it('still refuses "hey casino" — a television says that', () => {
    expect(detectWakeWord('hey casino').detected).toBe(false)
    // ...but the deliberate demo greeting may still carry the garble.
    expect(detectWakeWord("what's up casino").detected).toBe(true)
  })
})

// Straight off his machine, 2026-08-30 — the exact strings a quiet mic and a
// tight VAD produced from "What's up Pacino". Each one cost a take.
describe('the mishears that actually happened', () => {
  it('wakes on the clipped and garbled forms', () => {
    expect(detectWakeWord("What's that, Pac").detected).toBe(true)
    expect(detectWakeWord(' What\u2019s up, Pacino').detected).toBe(true)
    expect(detectWakeWord('whats that pacino').detected).toBe(true)
    expect(detectWakeWord("what's up pac").detected).toBe(true)
  })

  it('still needs BOTH halves — a stray "pac" is not a cue', () => {
    expect(detectWakeWord('pac').detected).toBe(false)
    expect(detectWakeWord("what's that").detected).toBe(false)
    expect(detectWakeWord('what was that').detected).toBe(false)
    // Too short a tail to pair with a bare greeting.
    expect(detectWakeWord('hey pac').detected).toBe(false)
  })
})
