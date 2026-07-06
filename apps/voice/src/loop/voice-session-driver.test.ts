import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PcmAudio, SpeechRecognizer, VoiceActivityDetector } from '@vynel/voice-engine'
import { FakeVoiceEngine } from '@vynel/voice-engine/test-support'
import { VoiceSessionDriver } from './voice-session-driver.js'
import type { VoiceBrainEvent, VoiceSessionIo, VoiceSessionState } from './voice-session-types.js'

// Pass-through VAD: each pushed chunk is one complete segment ("one utterance
// per pushAudio").
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

function buildDriver(
  transcripts: string[],
  brain: (u: string) => AsyncIterable<VoiceBrainEvent>,
  options?: { idleTimeoutMs?: number; autoDrain?: boolean },
) {
  const io = new RecordingIo()
  const recognizer = new ScriptedRecognizer(transcripts)
  const synthesizer = new FakeVoiceEngine()
  const driver = new VoiceSessionDriver(
    { vad: new PassThroughVad(), recognizer, synthesizer, runBrainTurn: brain, io },
    options?.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {},
  )
  if (options?.autoDrain !== false) io.onEndSpeech = () => driver.notifyPlaybackDrained()
  return { driver, io, recognizer, synthesizer }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('VoiceSessionDriver', () => {
  it('stays asleep and ignores speech that is not the wake word', async () => {
    const { driver, io, synthesizer } = buildDriver(['what time is it'], () => brainSaying('never'))
    await driver.pushAudio(chunk())
    expect(driver.isAwake).toBe(false)
    expect(synthesizer.spoken).toEqual([])
    expect(io.states).not.toContain('thinking')
  })

  it('wakes on "hey vynel <command>", answers, and stays in the conversation', async () => {
    const { driver, io, synthesizer } = buildDriver(
      ['hey vynel what is the time'],
      () => brainSaying('It is noon. ', 'Anything else?'),
    )
    await driver.pushAudio(chunk())
    expect(synthesizer.spoken).toEqual(['It is noon.', 'Anything else?'])
    expect(io.states).toContain('thinking')
    expect(io.states.at(-1)).toBe('listening') // active conversation, not asleep
    expect(driver.isAwake).toBe(true)
  })

  it('takes follow-up commands with no re-wake while active', async () => {
    const { driver, synthesizer } = buildDriver(
      ['hey vynel first question', 'and a follow up'],
      () => brainSaying('Answer.'),
    )
    await driver.pushAudio(chunk()) // wake + first command
    await driver.pushAudio(chunk()) // follow-up, no wake word
    expect(synthesizer.spoken).toEqual(['Answer.', 'Answer.'])
  })

  it('handles a bare "hey vynel" then the command as the next segment', async () => {
    const { driver, io, synthesizer } = buildDriver(['hey vynel', 'what is the time'], () =>
      brainSaying('Noon.'),
    )
    await driver.pushAudio(chunk())
    expect(io.states.at(-1)).toBe('listening')
    expect(synthesizer.spoken).toEqual([])

    await driver.pushAudio(chunk())
    expect(synthesizer.spoken).toEqual(['Noon.'])
  })

  it('falls back asleep after the idle timeout, then ignores non-wake speech', async () => {
    vi.useFakeTimers()
    const { driver, synthesizer } = buildDriver(['hey vynel', 'what is the time'], () =>
      brainSaying('unused'), { idleTimeoutMs: 5000 })

    await driver.pushAudio(chunk()) // bare wake → active
    expect(driver.isAwake).toBe(true)

    await vi.advanceTimersByTimeAsync(5001) // silence
    expect(driver.isAwake).toBe(false)

    await driver.pushAudio(chunk()) // 'what is the time' — no wake, asleep → ignored
    expect(synthesizer.spoken).toEqual([])
  })

  it('speaks a failure line when the brain turn fails', async () => {
    const { driver, synthesizer } = buildDriver(['hey vynel break it'], () => brainFailing())
    await driver.pushAudio(chunk())
    expect(synthesizer.spoken).toEqual(['Sorry, I ran into a problem with that.'])
  })

  it('keeps the mic closed until the shell reports playback drained (echo defense)', async () => {
    const { driver, io, recognizer } = buildDriver(['hey vynel talk to me'], () => brainSaying('Hi.'), {
      autoDrain: false,
    })

    const turn = driver.pushAudio(chunk())
    await flush()
    expect(io.endSpeechCount).toBe(1)
    expect(io.states.at(-1)).toBe('speaking')

    const callsBefore = recognizer.calls
    await driver.pushAudio(chunk()) // mid-speech mic frame — dropped
    expect(recognizer.calls).toBe(callsBefore)

    driver.notifyPlaybackDrained()
    await turn
    expect(io.states.at(-1)).toBe('listening')
  })
})
