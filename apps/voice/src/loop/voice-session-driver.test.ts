import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PcmAudio, SpeechRecognizer, VoiceActivityDetector, VoiceEngine } from '@vynel/voice-engine'
import { FakeVoiceEngine } from '@vynel/voice-engine/test-support'
import { VoiceSessionDriver } from './voice-session-driver.js'
import type {
  VoiceBrainEvent,
  VoiceSessionIo,
  VoiceSessionState,
  WakeHandoff,
} from './voice-session-types.js'

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
  cutPlaybackCount = 0
  cutPlayback(): void {
    this.cutPlaybackCount += 1
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

class RecordingWakeHandoff implements WakeHandoff {
  handOff = true
  published: string[] = []
  shouldHandOff(): boolean {
    return this.handOff
  }
  publishWake(command: string): void {
    this.published.push(command)
  }
}

function buildDriver(
  transcripts: string[],
  brain: (u: string, signal: AbortSignal) => AsyncIterable<VoiceBrainEvent>,
  options?: {
    idleTimeoutMs?: number
    turnWatchdogMs?: number
    autoDrain?: boolean
    wakeHandoff?: WakeHandoff
    onTurnWatchdog?: (utterance: string) => void
  },
) {
  const io = new RecordingIo()
  const recognizer = new ScriptedRecognizer(transcripts)
  const synthesizer = new FakeVoiceEngine()
  const driver = new VoiceSessionDriver(
    {
      vad: new PassThroughVad(),
      recognizer,
      synthesizer,
      runBrainTurn: brain,
      io,
      ...(options?.wakeHandoff ? { wakeHandoff: options.wakeHandoff } : {}),
      ...(options?.onTurnWatchdog ? { onTurnWatchdog: options.onTurnWatchdog } : {}),
    },
    {
      ...(options?.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
      ...(options?.turnWatchdogMs !== undefined ? { turnWatchdogMs: options.turnWatchdogMs } : {}),
    },
  )
  if (options?.autoDrain !== false) io.onEndSpeech = () => driver.notifyPlaybackDrained()
  return { driver, io, recognizer, synthesizer }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** A turn the server never answers — it ends only when the watchdog aborts the
 *  read, having yielded nothing at all (exactly what the brain client does on
 *  an abort: the SERVER turn keeps running, this read simply stops). */
function brainHangingUntilAbort(observed: { signal: AbortSignal | null }) {
  return (_utterance: string, signal: AbortSignal): AsyncIterable<VoiceBrainEvent> => ({
    [Symbol.asyncIterator]() {
      observed.signal = signal
      const aborted = new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return {
        async next(): Promise<IteratorResult<VoiceBrainEvent>> {
          await aborted
          return { done: true, value: undefined }
        },
      }
    },
  })
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

  it('wakes on "hey vynel <command>", runs the turn (no local TTS), and stays in the conversation', async () => {
    let turns = 0
    const { driver, io, synthesizer } = buildDriver(['hey vynel what is the time'], () => {
      turns += 1
      return brainSaying('ignored') // the daemon no longer speaks the reply
    })
    await driver.pushAudio(chunk())
    expect(turns).toBe(1)
    expect(io.states).toContain('thinking')
    expect(synthesizer.spoken).toEqual([]) // voice output is the `speak` tool, not the daemon
    expect(io.states.at(-1)).toBe('listening') // active conversation, not asleep
    expect(driver.isAwake).toBe(true)
  })

  it('takes follow-up commands with no re-wake while active', async () => {
    let turns = 0
    const { driver } = buildDriver(['hey vynel first question', 'and a follow up'], () => {
      turns += 1
      return brainSaying('ignored')
    })
    await driver.pushAudio(chunk()) // wake + first command
    await driver.pushAudio(chunk()) // follow-up, no wake word
    expect(turns).toBe(2)
  })

  it('handles a bare "hey vynel" then the command as the next segment', async () => {
    let turns = 0
    const { driver, io } = buildDriver(['hey vynel', 'what is the time'], () => {
      turns += 1
      return brainSaying('ignored')
    })
    await driver.pushAudio(chunk())
    expect(io.states.at(-1)).toBe('listening')
    expect(turns).toBe(0) // bare wake — no command ran yet

    await driver.pushAudio(chunk())
    expect(turns).toBe(1)
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

  it('speaks a failure line when the brain turn fails (the tool queue plays it)', async () => {
    const { driver, synthesizer } = buildDriver(['hey vynel break it'], () => brainFailing())
    await driver.pushAudio(chunk())
    await flush() // the queued failure line drains once the turn frees
    expect(synthesizer.spoken).toEqual(['Sorry, I ran into a problem with that.'])
  })

  it('hands the wake to a connected overlay instead of running the native turn', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, io, synthesizer } = buildDriver(
      ['hey vynel what is the time', 'ignored while handed off'],
      () => brainSaying('never'),
      { wakeHandoff },
    )
    await driver.pushAudio(chunk())
    expect(wakeHandoff.published).toEqual(['what is the time'])
    expect(synthesizer.spoken).toEqual([]) // the browser session speaks, not the daemon
    expect(io.states.at(-1)).toBe('wake')

    await driver.pushAudio(chunk()) // overlay owns the session — daemon deaf
    expect(wakeHandoff.published).toHaveLength(1)
    expect(synthesizer.spoken).toEqual([])
  })

  it('publishes a bare wake with an empty command and resumes on endHandoff', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, io, synthesizer } = buildDriver(
      ['hey vynel', 'hey vynel again'],
      () => brainSaying('never'),
      { wakeHandoff },
    )
    await driver.pushAudio(chunk())
    expect(wakeHandoff.published).toEqual([''])

    driver.endHandoff()
    expect(driver.isAwake).toBe(false)
    expect(io.states.at(-1)).toBe('idle')

    await driver.pushAudio(chunk()) // asleep again — the next wake hands off again
    expect(wakeHandoff.published).toEqual(['', 'again'])
    expect(synthesizer.spoken).toEqual([])
  })

  it('runs the native turn when no overlay is connected', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    wakeHandoff.handOff = false
    let turns = 0
    const { driver, io } = buildDriver(
      ['hey vynel what is the time'],
      () => {
        turns += 1
        return brainSaying('ignored')
      },
      { wakeHandoff },
    )
    await driver.pushAudio(chunk())
    expect(wakeHandoff.published).toEqual([])
    expect(turns).toBe(1) // ran natively (no handoff)
    expect(io.states).toContain('thinking')
  })

  it('speaks external text (the speak tool) sentence-by-sentence and stays asleep', async () => {
    const { driver, io, synthesizer } = buildDriver([], () => brainSaying('unused'))
    driver.speak('Your report is ready. Two approvals are waiting.')
    await flush()
    expect(synthesizer.spoken).toEqual(['Your report is ready.', 'Two approvals are waiting.'])
    expect(io.endSpeechCount).toBe(1)
    expect(driver.isAwake).toBe(false) // a proactive line doesn't open a conversation
  })

  it('serializes queued speaks so proactive lines never overlap', async () => {
    const { driver, synthesizer } = buildDriver([], () => brainSaying('unused'))
    driver.speak('First.')
    driver.speak('Second.')
    await flush()
    expect(synthesizer.spoken).toEqual(['First.', 'Second.'])
  })

  it('ignores an empty speak', async () => {
    const { driver, io, synthesizer } = buildDriver([], () => brainSaying('unused'))
    driver.speak('   ')
    await flush()
    expect(synthesizer.spoken).toEqual([])
    expect(io.endSpeechCount).toBe(0)
  })

  it('recovers from a synth failure — one bad line never bricks the queue', async () => {
    let calls = 0
    const flakySynth: VoiceEngine = {
      synthesize() {
        calls += 1
        if (calls === 1) return Promise.reject(new Error('model hiccup'))
        return Promise.resolve({ samples: new Float32Array(8), sampleRate: 24000 })
      },
    }
    const io = new RecordingIo()
    const driver = new VoiceSessionDriver({
      vad: new PassThroughVad(),
      recognizer: new ScriptedRecognizer([]),
      synthesizer: flakySynth,
      runBrainTurn: () => brainSaying('unused'),
      io,
    })
    io.onEndSpeech = () => driver.notifyPlaybackDrained()

    driver.speak('This one fails.')
    await flush()
    driver.speak('This one works.')
    await flush()
    expect(calls).toBe(2) // the second speak still reached the synth
    expect(driver.isAwake).toBe(false) // state restored, not stuck busy
  })

  it('speaks during a handoff (the tool plays while the browser owns the mic) and stays handed off', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, synthesizer } = buildDriver(['hey vynel'], () => brainSaying('unused'), {
      wakeHandoff,
    })
    await driver.pushAudio(chunk()) // wake → handed-off (overlay owns the session)
    expect(driver.isHandedOff).toBe(true)
    driver.speak('The brain is answering.')
    await flush()
    // The daemon speaker is free during a handoff — the overlay's brain replies
    // via the `speak` tool, so it plays now (not deferred).
    expect(synthesizer.spoken).toEqual(['The brain is answering.'])

    // The handoff wasn't yanked to a native conversation — endHandoff still has
    // a handed-off state to return to sleep.
    driver.endHandoff()
    expect(driver.isAwake).toBe(false)
  })

  it('honors an endHandoff that arrives WHILE a handed-off speak is draining (no deaf daemon)', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver } = buildDriver(['hey vynel', 'hey vynel again'], () => brainSaying('unused'), {
      wakeHandoff,
      autoDrain: false,
    })
    await driver.pushAudio(chunk()) // wake → handed-off
    expect(wakeHandoff.published).toEqual([''])

    driver.speak('A long answer is playing.')
    await flush() // drain started, blocked awaiting playback (state forced busy)
    // Mid-drain the state is forced 'busy', but the overlay still owns the
    // session — isHandedOff must see through the drain (speak routing keys on it).
    expect(driver.isHandedOff).toBe(true)

    driver.endHandoff() // overlay closed mid-sentence — must not be swallowed
    driver.notifyPlaybackDrained()
    await flush()
    expect(driver.isHandedOff).toBe(false)

    // The daemon took the mic back (asleep), not stuck handed-off: a fresh wake
    // is heard + handed off again (a deaf daemon would drop this frame).
    await driver.pushAudio(chunk())
    expect(wakeHandoff.published).toEqual(['', 'again'])
  })

  it('hands the room back when a turn outstays the watchdog, and aborts only the READ', async () => {
    vi.useFakeTimers()
    const observed: { signal: AbortSignal | null } = { signal: null }
    const watchdogged: string[] = []
    const { driver, io, synthesizer } = buildDriver(
      ['hey vynel take forever'],
      brainHangingUntilAbort(observed),
      { turnWatchdogMs: 300_000, onTurnWatchdog: (utterance) => watchdogged.push(utterance) },
    )

    const pushed = driver.pushAudio(chunk())
    await vi.advanceTimersByTimeAsync(299_000)
    expect(io.states.at(-1)).toBe('thinking') // still waiting, still deaf
    expect(synthesizer.spoken).toEqual([])

    await vi.advanceTimersByTimeAsync(2_000)
    await pushed
    await vi.advanceTimersByTimeAsync(1)

    expect(watchdogged).toEqual(['take forever'])
    expect(observed.signal?.aborted).toBe(true) // the READ stopped; the server turn did not
    expect(synthesizer.spoken).toEqual(["Still working on that — I'll tell you when it's done."])
    expect(driver.isAwake).toBe(true)
    expect(io.states.at(-1)).toBe('listening') // the room is back
  })

  it("plays the abandoned turn's later speak calls normally — not dropped, not doubled", async () => {
    vi.useFakeTimers()
    const observed: { signal: AbortSignal | null } = { signal: null }
    const { driver, synthesizer } = buildDriver(
      ['hey vynel take forever'],
      brainHangingUntilAbort(observed),
      { turnWatchdogMs: 1_000 },
    )

    const pushed = driver.pushAudio(chunk())
    await vi.advanceTimersByTimeAsync(1_001)
    await pushed
    await vi.advanceTimersByTimeAsync(1)

    // The server turn finished minutes later and called the `speak` tool.
    driver.speak('Your deploy is green.')
    await vi.advanceTimersByTimeAsync(1)
    expect(synthesizer.spoken).toEqual([
      "Still working on that — I'll tell you when it's done.",
      'Your deploy is green.',
    ])
  })

  it('never fires the watchdog on a turn that answers in time', async () => {
    vi.useFakeTimers()
    const { driver, synthesizer } = buildDriver(['hey vynel quick one'], () => brainSaying('ignored'), {
      turnWatchdogMs: 1_000,
    })

    await driver.pushAudio(chunk())
    await vi.advanceTimersByTimeAsync(10_000)
    expect(synthesizer.spoken).toEqual([]) // no "still working" line
  })

  it('says one line when the server parks the turn, and stays BUSY until the answer lands', async () => {
    const gate = deferred()
    const { driver, io, recognizer, synthesizer } = buildDriver(
      ['hey vynel do the thing'],
      async function* () {
        yield { kind: 'queued' }
        yield { kind: 'queued' } // a second sentinel must not speak a second line
        await gate.promise
        yield { kind: 'completed' }
      },
    )

    const pushed = driver.pushAudio(chunk())
    await flush()
    expect(synthesizer.spoken).toEqual(['One moment.'])
    expect(io.states.at(-1)).toBe('thinking') // back to the turn, NOT to listening

    const callsBefore = recognizer.calls
    await driver.pushAudio(chunk()) // mic frame while the turn still runs — dropped
    expect(recognizer.calls).toBe(callsBefore)

    gate.resolve()
    await pushed
    await flush()
    expect(io.states.at(-1)).toBe('listening')
    expect(driver.isAwake).toBe(true)
  })

  it('a turn that ends WHILE its notice is playing hands the room back, not a stuck busy', async () => {
    const gate = deferred()
    const { driver, io } = buildDriver(
      ['hey vynel do the thing'],
      async function* () {
        yield { kind: 'queued' }
        await gate.promise
        yield { kind: 'completed' }
      },
      { autoDrain: false },
    )

    const pushed = driver.pushAudio(chunk())
    await flush() // the notice is mid-playback (blocked on the drain signal)
    expect(io.states.at(-1)).toBe('speaking')

    gate.resolve() // the answer lands before the notice finished playing
    await pushed
    driver.notifyPlaybackDrained()
    await flush()

    expect(driver.isAwake).toBe(true)
    expect(io.states.at(-1)).toBe('listening')
  })

  it('keeps the mic closed while an external speak plays (echo defense)', async () => {
    const { driver, io, recognizer } = buildDriver([], () => brainSaying('unused'), {
      autoDrain: false,
    })

    driver.speak('Speaking a proactive line now.')
    await flush()
    expect(io.endSpeechCount).toBe(1)
    expect(io.states.at(-1)).toBe('speaking')

    const callsBefore = recognizer.calls
    await driver.pushAudio(chunk()) // mic frame mid-speech — dropped (busy)
    expect(recognizer.calls).toBe(callsBefore)

    driver.notifyPlaybackDrained()
    await flush()
    expect(io.states.at(-1)).toBe('idle') // drained → back to the prior (asleep) state
  })
})
