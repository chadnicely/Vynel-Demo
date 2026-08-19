import { describe, expect, it } from 'vitest'
import {
  ECHO_MEMORY_LINES,
  ECHO_RETURN_WINDOW_MS,
  SpokenEchoFilter,
  isEchoOfSpokenLine,
} from './spoken-echo-filter.js'

// The matcher cases, ported from call-turn-policy (the filter is their home now).
describe('isEchoOfSpokenLine', () => {
  const LINE = 'Cool. Let me know if you need anything else.'

  it('matches the whole line and any word-bounded fragment of it', () => {
    expect(isEchoOfSpokenLine('Cool. Let me know if you need anything else.', [LINE])).toBe(true)
    expect(isEchoOfSpokenLine('let me know if you need', [LINE])).toBe(true)
    expect(isEchoOfSpokenLine('cool', [LINE])).toBe(true)
  })

  it('ignores punctuation and case differences — STT rarely returns them verbatim', () => {
    expect(isEchoOfSpokenLine('cool let me know', [LINE])).toBe(true)
    expect(isEchoOfSpokenLine('COOL!', [LINE])).toBe(true)
  })

  it('requires word boundaries — a word inside another word is not an echo', () => {
    expect(isEchoOfSpokenLine('me kno', [LINE])).toBe(false)
    expect(isEchoOfSpokenLine('anything else again', [LINE])).toBe(false)
  })

  it('one or two characters carry no echo evidence', () => {
    expect(isEchoOfSpokenLine('me', [LINE])).toBe(false)
    expect(isEchoOfSpokenLine('', [LINE])).toBe(false)
  })

  it('no recent lines, no echo', () => {
    expect(isEchoOfSpokenLine('cool', [])).toBe(false)
  })

  it('a short utterance is weighed against the TAIL — a long reply never swallows a barge-in', () => {
    // The whole streamed answer is ONE remembered line, so "stop" three
    // sentences back must not make the user's "stop" our own voice.
    const reply =
      'I can stop the deployment if you want me to. The build is green and the tests all passed. ' +
      'Nothing else is waiting on you right now. Your next meeting starts in about twenty minutes.'

    expect(isEchoOfSpokenLine('stop', [reply])).toBe(false)
    expect(isEchoOfSpokenLine('hold on', [reply])).toBe(false)
    expect(isEchoOfSpokenLine('twenty minutes', [reply])).toBe(true) // what we just said
    expect(isEchoOfSpokenLine('i can stop the deployment', [reply])).toBe(true) // a long run, anywhere
  })

  it('a short line is its own tail — nothing changes for a one-line reply', () => {
    expect(isEchoOfSpokenLine('cool', [LINE])).toBe(true)
  })
})

describe('SpokenEchoFilter', () => {
  it('a line is hearable from the moment it is remembered, open-ended until it ends', () => {
    const filter = new SpokenEchoFilter()
    const line = filter.remember('All green. Nothing to worry about.')

    expect(filter.isEcho('nothing to worry about', 1_000)).toBe(true)
    expect(filter.isEcho('nothing to worry about', 10_000_000)).toBe(true) // still playing — no window yet

    line.end(10_000)
    expect(filter.isEcho('all green', 10_000 + ECHO_RETURN_WINDOW_MS - 1)).toBe(true)
    expect(filter.isEcho('all green', 10_000 + ECHO_RETURN_WINDOW_MS + 1)).toBe(false)
  })

  it('a streamed reply grows as ONE line, so a fragment straddling two sentences is still an echo', () => {
    const filter = new SpokenEchoFilter()
    const line = filter.remember('Your first meeting is at nine.')
    line.append('Then lunch with Sam at noon.')

    expect(filter.isEcho('at nine then lunch with sam', 0)).toBe(true)
    expect(filter.hearableLines(0)).toEqual(['Your first meeting is at nine. Then lunch with Sam at noon.'])
  })

  it('a barge-in word buried in a long streamed reply is the USER, not an echo', () => {
    const filter = new SpokenEchoFilter()
    const line = filter.remember('I can stop the deployment if you want me to.')
    line.append('The build is green and the tests all passed.')
    line.append('Nothing else is waiting on you right now.')
    line.append('Your next meeting starts in about twenty minutes.')

    expect(filter.isEcho('stop', 0)).toBe(false)
    expect(filter.isEcho('twenty minutes', 0)).toBe(true)
  })

  it('anything that is not in a spoken line is the user', () => {
    const filter = new SpokenEchoFilter()
    filter.remember('Your first meeting is at nine.')

    expect(filter.isEcho('what about tomorrow', 0)).toBe(false)
  })

  it('forgets beyond the memory size — only the freshest lines are echo candidates', () => {
    const filter = new SpokenEchoFilter()
    for (let i = 0; i <= ECHO_MEMORY_LINES; i += 1) filter.remember(`line number ${i} here`)

    expect(filter.isEcho('line number 0 here', 0)).toBe(false)
    expect(filter.isEcho(`line number ${ECHO_MEMORY_LINES} here`, 0)).toBe(true)
  })

  it('honors a custom window and memory', () => {
    const filter = new SpokenEchoFilter({ returnWindowMs: 100, memoryLines: 1 })
    filter.remember('first line').end(0)
    filter.remember('second line').end(0)

    expect(filter.isEcho('first line', 50)).toBe(false) // evicted by the 1-line memory
    expect(filter.isEcho('second line', 50)).toBe(true)
    expect(filter.isEcho('second line', 150)).toBe(false) // past the 100 ms window
  })
})
