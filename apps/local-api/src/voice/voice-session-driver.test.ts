import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PcmAudio, SpeechRecognizer, VoiceActivityDetector } from '@vynel/voice-engine'
import { FakeVoiceEngine } from '@vynel/voice-engine/test-support'
import { VoiceSessionDriver } from './voice-session-driver.js'
import type { VoiceBrainEvent, VoiceSessionIo, VoiceSessionState } from './voice-session-types.js'

// Pass-through VAD: each pushed chunk is treated as one complete segment, so a
// test controls "one utterance per pushAudio".
class PassThroughVad implements VoiceActivityDetector {
  push(audio: PcmAudio): PcmAudio[] {
    return [audio]
  }
  flush(): PcmAudio[] {
    return []
  }
}

// Returns the queued transcripts in order — the Nth segment "says" the Nth entry.
class ScriptedRecognizer implements SpeechRecognizer {
  #queue: string[]
  calls = 0
  constructor(transcripts: string[]) {
    this.#queue = [...transcripts]
  }
  transcribe(): Promise<string> {
    this.calls += 1
    return Promise.resolve(this.#queue.shift() ?? '')
  }
}

class RecordingIo implements VoiceSessionIo {
  states: VoiceSessionState[] = []
  audio: PcmAudio[] = []
  endSpeechCount = 0
  onEndSpeech: (() => void) | null = null
  setState(state: VoiceSessionState): void {
    this.states.push(state)
  }
  emitAudio(audio: PcmAudio): void {
    this.audio.push(audio)
  }
  endSpeech(): void {
    this.endSpeechCount += 1
    this.onEndSpeech?.()
  }
}

async function* brainSaying(...deltas: string[]): AsyncIterable<VoiceBrainEvent> {
  for (const delta of deltas) yield { kind: 'text', delta }
  yield { kind: 'completed' }
}

async function* brainFailing(): AsyncIterable<VoiceBrainEvent> {
  yield { kind: 'failed', message: 'boom' }
}

const chunk = (): PcmAudio => ({ samples: new Float32Array(160), sampleRate: 16000 })
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function buildDriver(transcripts: string[], brain: (u: string) => AsyncIterable<VoiceBrainEvent>) {
  const io = new RecordingIo()
  const recognizer = new ScriptedRecognizer(transcripts)
  const synthesizer = new FakeVoiceEngine()
  const driver = new VoiceSessionDriver({
    vad: new PassThroughVad(),
    recognizer,
    synthesizer,
    runBrainTurn: brain,
    io,
  })
  return { driver, io, recognizer, synthesizer }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('VoiceSessionDriver', () => {
  it('ignores speech that does not open with the wake word', async () => {
    const { driver, io, synthesizer } = buildDriver(['what time is it'], () => brainSaying('never'))
    await driver.pushAudio(chunk())
    expect(synthesizer.spoken).toEqual([])
    expect(io.states).not.toContain('thinking')
  })

  it('runs a one-segment wake+command turn and speaks the answer sentence-by-sentence', async () => {
    const { driver, io, synthesizer } = buildDriver(
      ['hey vynel what is the time'],
      () => brainSaying('It is noon. ', 'Anything else?'),
    )
    io.onEndSpeech = () => driver.notifyPlaybackDrained()

    await driver.pushAudio(chunk())

    // First sentence emits on its boundary; the rest on flush — pipelined.
    expect(synthesizer.spoken).toEqual(['It is noon.', 'Anything else?'])
    expect(io.states).toContain('thinking')
    expect(io.states).toContain('speaking')
    expect(io.states.at(-1)).toBe('listening')
    expect(io.endSpeechCount).toBe(1)
    expect(io.audio).toHaveLength(2)
  })

  it('handles wake-then-pause: a bare "hey vynel" then the command as the next segment', async () => {
    const { driver, io, synthesizer } = buildDriver(['hey vynel', 'what is the time'], () =>
      brainSaying('Noon.'),
    )
    io.onEndSpeech = () => driver.notifyPlaybackDrained()

    await driver.pushAudio(chunk()) // bare wake
    expect(io.states.at(-1)).toBe('wake')
    expect(synthesizer.spoken).toEqual([])

    await driver.pushAudio(chunk()) // the command
    expect(synthesizer.spoken).toEqual(['Noon.'])
    expect(io.states.at(-1)).toBe('listening')
  })

  it('speaks a failure line when the brain turn fails', async () => {
    const { driver, io, synthesizer } = buildDriver(['hey vynel break something'], () => brainFailing())
    io.onEndSpeech = () => driver.notifyPlaybackDrained()
    await driver.pushAudio(chunk())
    expect(synthesizer.spoken).toEqual(['Sorry, I ran into a problem with that.'])
    expect(io.states.at(-1)).toBe('listening')
  })

  it('keeps the mic closed until the client reports playback drained (echo defense)', async () => {
    const { driver, io, recognizer } = buildDriver(['hey vynel talk to me'], () => brainSaying('Hi.'))
    // No auto-drain — simulate a client still playing audio.

    const turn = driver.pushAudio(chunk())
    await flush()

    // The turn has spoken + signalled end-of-speech, but has NOT reopened the mic.
    expect(io.endSpeechCount).toBe(1)
    expect(io.states.at(-1)).toBe('speaking')

    // A mic frame arriving mid-speech is dropped (not transcribed).
    const callsBefore = recognizer.calls
    await driver.pushAudio(chunk())
    expect(recognizer.calls).toBe(callsBefore)

    // Client finishes playback → mic reopens.
    driver.notifyPlaybackDrained()
    await turn
    expect(io.states.at(-1)).toBe('listening')
  })

  it('returns to listening if no command follows a bare wake within the timeout', async () => {
    vi.useFakeTimers()
    const { driver, io } = buildDriver(['hey vynel'], () => brainSaying('unused'))

    await driver.pushAudio(chunk())
    expect(io.states.at(-1)).toBe('wake')

    await vi.advanceTimersByTimeAsync(6001)
    expect(io.states.at(-1)).toBe('listening')
  })
})
