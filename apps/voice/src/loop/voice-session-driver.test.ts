import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { PcmAudio, SpeechRecognizer, VoiceActivityDetector, VoiceEngine } from '@vynel/voice-engine'
import { FakeVoiceEngine } from '@vynel/voice-engine/test-support'
import { VoiceSessionDriver } from './voice-session-driver.js'
import type {
  VoiceBrainClient,
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
  cutPlaybackCount = 0
  onEndSpeech: (() => void) | null = null
  onCut: (() => void) | null = null
  /** Break the status surface ONCE (a dead IPC channel) — the only seam a turn
   *  can throw through where nothing inside it catches. */
  failNextSetState = false
  setState(state: VoiceSessionState): void {
    if (this.failNextSetState) {
      this.failNextSetState = false
      throw new Error('status surface is gone')
    }
    this.states.push(state)
  }
  emitAudio(audio: PcmAudio): void {
    this.audio.push(audio)
  }
  endSpeech(): void {
    this.endSpeechCount += 1
    this.onEndSpeech?.()
  }
  cutPlayback(): void {
    this.cutPlaybackCount += 1
    this.onCut?.()
  }
}

async function* brainSaying(...deltas: string[]): AsyncIterable<VoiceBrainEvent> {
  for (const delta of deltas) yield { kind: 'text', delta }
  yield { kind: 'completed' }
}

async function* brainFailing(): AsyncIterable<VoiceBrainEvent> {
  yield { kind: 'failed', message: 'boom' }
}

/** A brain whose runs the test drives by hand: emit events, end the stream,
 *  observe the read's abort signal. */
function controllableBrain() {
  const runs: Array<{
    utterance: string
    signal: AbortSignal
    emit: (event: VoiceBrainEvent) => void
    end: () => void
  }> = []
  const runTurn = (utterance: string, signal: AbortSignal): AsyncIterable<VoiceBrainEvent> => ({
    [Symbol.asyncIterator]() {
      const queue: VoiceBrainEvent[] = []
      let ended = false
      let wake: (() => void) | null = null
      const notify = (): void => {
        const w = wake
        wake = null
        w?.()
      }
      signal.addEventListener('abort', notify, { once: true })
      runs.push({
        utterance,
        signal,
        emit: (event) => {
          queue.push(event)
          notify()
        },
        end: () => {
          ended = true
          notify()
        },
      })
      return {
        async next(): Promise<IteratorResult<VoiceBrainEvent>> {
          for (;;) {
            if (queue.length > 0) return { value: queue.shift()!, done: false }
            // The real client yields nothing more once the read is aborted.
            if (ended || signal.aborted) return { value: undefined, done: true }
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
        },
        async return(): Promise<IteratorResult<VoiceBrainEvent>> {
          ended = true
          return { value: undefined, done: true }
        },
      }
    },
  })
  return { runTurn, runs }
}

const chunk = (): PcmAudio => ({ samples: new Float32Array(160), sampleRate: 16000 })
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
// A detached turn settles over several microtask/macrotask hops (stream read →
// lane → synth → emit → drain).
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush()
}

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
    synthesizer?: VoiceEngine
    transcribeCommand?: (audio: PcmAudio) => Promise<string>
  },
) {
  const io = new RecordingIo()
  const recognizer = new ScriptedRecognizer(transcripts)
  const synthesizer = new FakeVoiceEngine()
  const interruptTurn = vi.fn(async (_sessionId: string) => true)
  const brainClient: VoiceBrainClient = {
    runTurn: (utterance, signal) => brain(utterance, signal ?? new AbortController().signal),
    interruptTurn,
  }
  const driver = new VoiceSessionDriver(
    {
      logger: pino({ level: 'silent' }),
      vad: new PassThroughVad(),
      recognizer,
      synthesizer: options?.synthesizer ?? synthesizer,
      brain: brainClient,
      io,
      ...(options?.wakeHandoff ? { wakeHandoff: options.wakeHandoff } : {}),
      ...(options?.onTurnWatchdog ? { onTurnWatchdog: options.onTurnWatchdog } : {}),
      ...(options?.transcribeCommand ? { transcribeCommand: options.transcribeCommand } : {}),
    },
    {
      ...(options?.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
      ...(options?.turnWatchdogMs !== undefined ? { turnWatchdogMs: options.turnWatchdogMs } : {}),
    },
  )
  if (options?.autoDrain !== false) {
    // Emulate the real sink: the device drains right after endSpeech, and a cut
    // that interrupted playback fires drained too.
    io.onEndSpeech = () => driver.notifyPlaybackDrained()
    io.onCut = () => driver.notifyPlaybackDrained()
  }
  return { driver, io, recognizer, synthesizer, interruptTurn }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('VoiceSessionDriver — wake + conversation', () => {
  it('stays asleep and ignores speech that is not the wake word', async () => {
    const { driver, io, synthesizer } = buildDriver(['what time is it'], () => brainSaying('never'))
    await driver.pushAudio(chunk())
    await settle()
    expect(driver.isAwake).toBe(false)
    expect(synthesizer.spoken).toEqual([])
    expect(io.states).not.toContain('thinking')
  })

  it('wakes on "hey vynel <command>", runs the turn, SPEAKS its streamed text, and stays in the conversation', async () => {
    let turns = 0
    const { driver, io, synthesizer } = buildDriver(['hey vynel what is the time'], () => {
      turns += 1
      return brainSaying('It is ', 'ten past nine. ', 'Anything else?')
    })
    await driver.pushAudio(chunk())
    await settle()
    expect(turns).toBe(1)
    expect(io.states).toContain('thinking')
    expect(io.states).toContain('speaking')
    // The thread's text IS its voice — chunked at sentence boundaries.
    expect(synthesizer.spoken).toEqual(['It is ten past nine.', 'Anything else?'])
    expect(io.endSpeechCount).toBe(1)
    expect(io.states.at(-1)).toBe('listening') // active conversation, not asleep
    expect(driver.isAwake).toBe(true)
  })

  it('speaks the FIRST sentence the moment it closes — while the model is still writing', async () => {
    const brain = controllableBrain()
    const { driver, io, synthesizer } = buildDriver(['hey vynel tell me more'], brain.runTurn)
    await driver.pushAudio(chunk())
    const run = brain.runs[0]!

    run.emit({ kind: 'text', delta: 'Here is the first part. And the sec' })
    await settle()
    expect(synthesizer.spoken).toEqual(['Here is the first part.']) // spoken mid-generation
    expect(io.states.at(-1)).toBe('speaking')
    expect(driver.isAwake).toBe(true)

    run.emit({ kind: 'text', delta: 'ond part.' })
    run.emit({ kind: 'completed' })
    await settle()
    expect(synthesizer.spoken).toEqual(['Here is the first part.', 'And the second part.'])
    expect(io.endSpeechCount).toBe(1) // one line, pipelined — not one drain per sentence
    expect(io.states.at(-1)).toBe('listening')
  })

  it('strips markdown from what it speaks', async () => {
    const { driver, synthesizer } = buildDriver(['hey vynel status'], () =>
      brainSaying('**All green.** See `deploy.log` for details.'),
    )
    await driver.pushAudio(chunk())
    await settle()
    expect(synthesizer.spoken).toEqual(['All green.', 'See deploy.log for details.'])
  })

  it('takes follow-up commands with no re-wake while active', async () => {
    let turns = 0
    const { driver } = buildDriver(['hey vynel first question', 'and a follow up'], () => {
      turns += 1
      return brainSaying('Sure.')
    })
    await driver.pushAudio(chunk()) // wake + first command
    await settle()
    await driver.pushAudio(chunk()) // follow-up, no wake word
    await settle()
    expect(turns).toBe(2)
  })

  it('handles a bare "hey vynel" then the command as the next segment', async () => {
    let turns = 0
    const { driver, io } = buildDriver(['hey vynel', 'what is the time'], () => {
      turns += 1
      return brainSaying('Nine.')
    })
    await driver.pushAudio(chunk())
    expect(io.states.at(-1)).toBe('listening')
    expect(turns).toBe(0) // bare wake — no command ran yet

    await driver.pushAudio(chunk())
    await settle()
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
    await vi.advanceTimersByTimeAsync(10)
    expect(synthesizer.spoken).toEqual([])
  })

  it('speaks a failure line when the brain turn fails', async () => {
    const { driver, synthesizer } = buildDriver(['hey vynel break it'], () => brainFailing())
    await driver.pushAudio(chunk())
    await settle()
    expect(synthesizer.spoken).toEqual(['Sorry, I ran into a problem with that.'])
  })

  // Audit r2 R2-O: the thread's streamed text IS its voice, so a turn that
  // succeeds having produced none leaves the room in silence — the user cannot
  // tell "done" from "hung".
  it('speaks an honest line when a turn ENDS having said nothing', async () => {
    const { driver, synthesizer } = buildDriver(['hey vynel file that'], async function* () {
      yield { kind: 'completed' }
    })
    await driver.pushAudio(chunk())
    await settle()
    expect(synthesizer.spoken).toEqual(["That's done — I didn't have anything to say about it."])
  })

  it('a turn someone stopped server-side ends quietly — a stop is not a failure', async () => {
    const { driver, io, synthesizer } = buildDriver(['hey vynel long task'], async function* () {
      yield { kind: 'text', delta: 'Starting. ' }
      yield { kind: 'interrupted' }
    })
    await driver.pushAudio(chunk())
    await settle()
    expect(synthesizer.spoken).toEqual(['Starting.'])
    expect(io.states.at(-1)).toBe('listening')
  })

  it('stays SILENT when the server parks the turn, and keeps the mic open while it waits', async () => {
    const brain = controllableBrain()
    const { driver, io, recognizer, synthesizer } = buildDriver(
      ['hey vynel do the thing', 'fine print'],
      brain.runTurn,
    )
    await driver.pushAudio(chunk())
    const run = brain.runs[0]!
    run.emit({ kind: 'queued' })
    run.emit({ kind: 'queued' })
    await settle()
    expect(synthesizer.spoken).toEqual([]) // no "One moment." (VR3)
    expect(io.states.at(-1)).toBe('thinking')

    const callsBefore = recognizer.calls
    await driver.pushAudio(chunk()) // a mic frame while the turn waits — HEARD (transcribed), not dropped
    expect(recognizer.calls).toBe(callsBefore + 1)
  })
})

describe('VoiceSessionDriver — barge-in + the echo filter (VR2)', () => {
  it('ignores a transcript that is an echo of what it just said', async () => {
    const brain = controllableBrain()
    let turns = 0
    const { driver, io } = buildDriver(
      ['hey vynel deploy status', 'nothing to worry about'],
      (utterance, signal) => {
        turns += 1
        return brain.runTurn(utterance, signal)
      },
    )
    await driver.pushAudio(chunk())
    brain.runs[0]!.emit({ kind: 'text', delta: 'All green, nothing to worry about. ' })
    await settle()

    await driver.pushAudio(chunk()) // the speaker's own words come back through the mic
    await settle()
    expect(turns).toBe(1) // not a command, not a barge-in
    expect(io.cutPlaybackCount).toBe(0)
  })

  it('a barge-in word buried in a LONG reply is still the user — the echo memory is not the whole answer', async () => {
    const brain = controllableBrain()
    const { driver, io, interruptTurn } = buildDriver(
      ['hey vynel deploy status', 'stop'],
      brain.runTurn,
    )
    await driver.pushAudio(chunk())
    const first = brain.runs[0]!
    first.emit({ kind: 'session', sessionId: 's-long' })
    first.emit({
      kind: 'text',
      delta:
        'I can stop the deployment if you want me to. The build is green and the tests all passed. ' +
        'Nothing else is waiting on you right now. Your next meeting starts in about twenty minutes. ',
    })
    await settle()

    // "stop" sits three sentences back in what we are saying — matching the
    // whole answer would swallow exactly the word people barge in with.
    await driver.pushAudio(chunk())
    await settle()
    expect(io.cutPlaybackCount).toBeGreaterThan(0)
    expect(interruptTurn).toHaveBeenCalledWith('s-long')
    expect(brain.runs[1]!.utterance).toBe('stop')
  })

  it('a REAL transcript while it speaks cuts playback, interrupts the server turn, and runs the new turn', async () => {
    const brain = controllableBrain()
    const { driver, io, synthesizer, interruptTurn } = buildDriver(
      ['hey vynel first question', 'actually, a different question'],
      brain.runTurn,
    )
    await driver.pushAudio(chunk())
    const first = brain.runs[0]!
    first.emit({ kind: 'session', sessionId: 'voice-session-1' })
    first.emit({ kind: 'text', delta: 'Long first answer, part one. ' })
    await settle()
    expect(synthesizer.spoken).toEqual(['Long first answer, part one.'])
    expect(io.states.at(-1)).toBe('speaking')

    await driver.pushAudio(chunk()) // the user talks over it
    await settle()
    expect(io.cutPlaybackCount).toBeGreaterThan(0)
    expect(interruptTurn).toHaveBeenCalledWith('voice-session-1')
    expect(first.signal.aborted).toBe(true) // stopped reading the old stream
    expect(brain.runs).toHaveLength(2)
    expect(brain.runs[1]!.utterance).toBe('actually, a different question')

    first.emit({ kind: 'text', delta: 'Part two never heard. ' }) // the dead stream's tail — dropped
    brain.runs[1]!.emit({ kind: 'text', delta: 'Second answer. ' })
    brain.runs[1]!.emit({ kind: 'completed' })
    await settle()
    expect(synthesizer.spoken).toEqual(['Long first answer, part one.', 'Second answer.'])
    expect(io.states.at(-1)).toBe('listening')
  })

  it('a barge-in while the turn is still thinking interrupts it too — no speech to cut', async () => {
    const brain = controllableBrain()
    const { driver, interruptTurn } = buildDriver(['hey vynel slow one', 'never mind'], brain.runTurn)
    await driver.pushAudio(chunk())
    brain.runs[0]!.emit({ kind: 'session', sessionId: 's-think' })
    await settle()

    await driver.pushAudio(chunk())
    await settle()
    expect(interruptTurn).toHaveBeenCalledWith('s-think')
    expect(brain.runs[1]!.utterance).toBe('never mind')
  })

  it('a barge-in before the session id arrived stops the server turn as soon as it is known', async () => {
    const brain = controllableBrain()
    const { driver, interruptTurn } = buildDriver(['hey vynel slow one', 'new question'], brain.runTurn)
    await driver.pushAudio(chunk())
    brain.runs[0]!.emit({ kind: 'queued' })
    await settle()

    await driver.pushAudio(chunk()) // barge-in on a turn the server has not named yet
    await settle()
    expect(interruptTurn).not.toHaveBeenCalled()
    expect(brain.runs).toHaveLength(2) // the new turn is already underway

    brain.runs[0]!.emit({ kind: 'session', sessionId: 's-late' })
    await settle()
    expect(interruptTurn).toHaveBeenCalledWith('s-late')
    expect(brain.runs[0]!.signal.aborted).toBe(true)
  })

  it('a barge-in on an answer whose stream already ended only cuts the speech — nothing to interrupt', async () => {
    const brain = controllableBrain()
    const synthGate = deferred()
    let synthCalls = 0
    const slowSynth: VoiceEngine = {
      async synthesize() {
        synthCalls += 1
        if (synthCalls === 2) await synthGate.promise // the second sentence's synthesis hangs
        return { samples: new Float32Array(8), sampleRate: 24000 }
      },
    }
    const { driver, io, interruptTurn } = buildDriver(
      ['hey vynel question', 'other question'],
      brain.runTurn,
      { synthesizer: slowSynth },
    )
    await driver.pushAudio(chunk())
    const first = brain.runs[0]!
    first.emit({ kind: 'session', sessionId: 's-done' })
    first.emit({ kind: 'text', delta: 'One. Two. ' })
    first.emit({ kind: 'completed' })
    await settle() // the stream is over; the speech is still playing (stuck on sentence two)

    await driver.pushAudio(chunk())
    await settle()
    expect(io.cutPlaybackCount).toBeGreaterThan(0)
    expect(interruptTurn).not.toHaveBeenCalled()
    synthGate.resolve()
    await settle()
    expect(brain.runs[1]!.utterance).toBe('other question')
  })

  it("an echo of a relay line is ignored once the mic reopens", async () => {
    let turns = 0
    const { driver, synthesizer } = buildDriver(['hey vynel', 'your report is ready'], () => {
      turns += 1
      return brainSaying('never')
    })
    await driver.pushAudio(chunk()) // bare wake → active
    driver.speak('Your report is ready.')
    await settle()
    expect(synthesizer.spoken).toEqual(['Your report is ready.'])

    await driver.pushAudio(chunk()) // the line's tail comes back through the mic
    await settle()
    expect(turns).toBe(0)
  })
})

describe('VoiceSessionDriver — the overlay handoff', () => {
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
        return brainSaying('Nine.')
      },
      { wakeHandoff },
    )
    await driver.pushAudio(chunk())
    await settle()
    expect(wakeHandoff.published).toEqual([])
    expect(turns).toBe(1) // ran natively (no handoff)
    expect(io.states).toContain('thinking')
  })

  it('speaks during a handoff (the tool plays while the browser owns the mic) and stays handed off', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, synthesizer } = buildDriver(['hey vynel'], () => brainSaying('unused'), {
      wakeHandoff,
    })
    await driver.pushAudio(chunk()) // wake → handed-off (overlay owns the session)
    expect(driver.isHandedOff).toBe(true)
    driver.speak('The brain is answering.')
    await settle()
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
    await settle() // drain started, blocked awaiting playback (state forced relaying)
    // Mid-drain the state is forced 'relaying', but the overlay still owns the
    // session — isHandedOff must see through the drain (speak routing keys on it).
    expect(driver.isHandedOff).toBe(true)

    driver.endHandoff() // overlay closed mid-sentence — must not be swallowed
    driver.notifyPlaybackDrained()
    await settle()
    expect(driver.isHandedOff).toBe(false)

    // The daemon took the mic back (asleep), not stuck handed-off: a fresh wake
    // is heard + handed off again (a deaf daemon would drop this frame).
    await driver.pushAudio(chunk())
    expect(wakeHandoff.published).toEqual(['', 'again'])
  })
})

// A browser voice session the user started HERSELF — the Display switch in the
// title bar, the mic button — never went through a wake, so before the
// `/session/start` seam the daemon knew nothing about it: it stayed ASLEEP with
// its mic open and ran every utterance through the native STT to test the wake
// phrase, under a Web Speech session that already owned the room.
describe('VoiceSessionDriver — a web session that started without a wake', () => {
  it('stops transcribing the room the web recognizer owns', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, recognizer, synthesizer } = buildDriver(
      ['hey vynel what is the time'],
      () => brainSaying('never'),
      { wakeHandoff },
    )
    driver.beginHandoff()
    expect(driver.isHandedOff).toBe(true)

    await driver.pushAudio(chunk())
    // Not transcribed AT ALL: the native STT is left to wake-word detection
    // and the no-browser cases. This is the whole bug — the utterance below
    // carries the wake phrase, and asleep the daemon would have woken on it
    // (the user's own words, or its reply coming back off the speakers, which
    // the echo filter never hears about because the browser plays it).
    expect(recognizer.calls).toBe(0)
    expect(wakeHandoff.published).toEqual([])
    expect(synthesizer.spoken).toEqual([])
  })

  it('gives the microphone back on endHandoff, and the wake word works again', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, io, recognizer } = buildDriver(
      ['hey vynel what is the time'],
      () => brainSaying('never'),
      { wakeHandoff },
    )
    driver.beginHandoff()
    driver.endHandoff()
    expect(driver.isAwake).toBe(false)
    expect(io.states.at(-1)).toBe('idle')

    await driver.pushAudio(chunk())
    expect(recognizer.calls).toBe(1)
    expect(wakeHandoff.published).toEqual(['what is the time'])
  })

  it('is a no-op when a wake already handed the room over', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, recognizer } = buildDriver(['hey vynel'], () => brainSaying('never'), {
      wakeHandoff,
    })
    await driver.pushAudio(chunk()) // wake → handed off
    const callsAfterWake = recognizer.calls

    // The client announces its start for EVERY session, wake-started or not.
    driver.beginHandoff()
    expect(driver.isHandedOff).toBe(true)
    driver.endHandoff() // one end still releases it — no nesting to unwind
    expect(driver.isAwake).toBe(false)
    expect(recognizer.calls).toBe(callsAfterWake)
  })

  it('abandons a native turn the daemon was already running', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    wakeHandoff.handOff = false // no capable client yet — the daemon answered
    const brain = controllableBrain()
    const { driver } = buildDriver(['hey vynel slow one'], brain.runTurn, { wakeHandoff })
    await driver.pushAudio(chunk())
    brain.runs[0]!.emit({ kind: 'session', sessionId: 's-native' })
    await settle()

    // The user opened the Display mid-answer: the web session takes the room.
    driver.beginHandoff()
    await settle()
    expect(driver.isHandedOff).toBe(true)
    expect(brain.runs[0]!.signal.aborted).toBe(true)
  })

  it('keeps the handoff when it lands mid-speak (the drain restores it)', async () => {
    const wakeHandoff = new RecordingWakeHandoff()
    const { driver, recognizer } = buildDriver(['hey vynel'], () => brainSaying('unused'), {
      wakeHandoff,
      autoDrain: false,
    })
    driver.speak('A scheduled line is playing.')
    await settle() // draining — the state is forced 'relaying'

    driver.beginHandoff() // the Display switch, mid-line
    expect(driver.isHandedOff).toBe(true)
    driver.notifyPlaybackDrained()
    await settle()

    // The drain restored the HANDOFF, not sleep — otherwise the daemon would
    // reopen its mic under a live web session the moment the line ended.
    expect(driver.isHandedOff).toBe(true)
    await driver.pushAudio(chunk())
    expect(recognizer.calls).toBe(0)
  })
})
describe('VoiceSessionDriver — external speak (the relay queue)', () => {
  it('speaks external text (the speak tool) sentence-by-sentence and stays asleep', async () => {
    const { driver, io, synthesizer } = buildDriver([], () => brainSaying('unused'))
    driver.speak('Your report is ready. Two approvals are waiting.')
    await settle()
    expect(synthesizer.spoken).toEqual(['Your report is ready.', 'Two approvals are waiting.'])
    expect(io.endSpeechCount).toBe(1)
    expect(driver.isAwake).toBe(false) // a proactive line doesn't open a conversation
  })

  it('serializes queued speaks so proactive lines never overlap', async () => {
    const { driver, synthesizer } = buildDriver([], () => brainSaying('unused'))
    driver.speak('First.')
    driver.speak('Second.')
    await settle()
    expect(synthesizer.spoken).toEqual(['First.', 'Second.'])
  })

  it('ignores an empty speak', async () => {
    const { driver, io, synthesizer } = buildDriver([], () => brainSaying('unused'))
    driver.speak('   ')
    await settle()
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
    const { driver } = buildDriver([], () => brainSaying('unused'), { synthesizer: flakySynth })

    driver.speak('This one fails.')
    await settle()
    driver.speak('This one works.')
    await settle()
    expect(calls).toBe(2) // the second speak still reached the synth
    expect(driver.isAwake).toBe(false) // state restored, not stuck
  })

  it('keeps the mic closed while an external speak plays, and restores the prior state after', async () => {
    const { driver, io, recognizer } = buildDriver([], () => brainSaying('unused'), {
      autoDrain: false,
    })

    driver.speak('Speaking a proactive line now.')
    await settle()
    expect(io.endSpeechCount).toBe(1)
    expect(io.states.at(-1)).toBe('speaking')

    const callsBefore = recognizer.calls
    await driver.pushAudio(chunk()) // mic frame mid-line — dropped (relaying)
    expect(recognizer.calls).toBe(callsBefore)

    driver.notifyPlaybackDrained()
    await settle()
    expect(io.states.at(-1)).toBe('idle') // drained → back to the prior (asleep) state
  })

  it('a speak that arrives mid-turn plays after the turn, never over it', async () => {
    const brain = controllableBrain()
    const { driver, synthesizer } = buildDriver(['hey vynel question'], brain.runTurn)
    await driver.pushAudio(chunk())
    const run = brain.runs[0]!
    run.emit({ kind: 'text', delta: 'Answer part one. ' })
    await settle()
    driver.speak('Your deploy is green.')
    await settle()
    expect(synthesizer.spoken).toEqual(['Answer part one.']) // queued, not spoken over the turn

    run.emit({ kind: 'text', delta: 'Part two. ' })
    run.emit({ kind: 'completed' })
    await settle()
    expect(synthesizer.spoken).toEqual(['Answer part one.', 'Part two.', 'Your deploy is green.'])
  })
})

describe('VoiceSessionDriver — the watchdog', () => {
  it('hands the room back when a turn stays silent past the watchdog, keeps reading, and speaks the late answer', async () => {
    vi.useFakeTimers()
    const brain = controllableBrain()
    const watchdogged: string[] = []
    const { driver, io, synthesizer } = buildDriver(['hey vynel take forever'], brain.runTurn, {
      turnWatchdogMs: 300_000,
      onTurnWatchdog: (utterance) => watchdogged.push(utterance),
    })

    await driver.pushAudio(chunk())
    const run = brain.runs[0]!
    run.emit({ kind: 'session', sessionId: 's-slow' })
    await vi.advanceTimersByTimeAsync(299_000)
    expect(io.states.at(-1)).toBe('thinking') // still waiting
    expect(synthesizer.spoken).toEqual([])

    await vi.advanceTimersByTimeAsync(2_000)
    expect(watchdogged).toEqual(['take forever'])
    expect(synthesizer.spoken).toEqual(["Still working on that — I'll tell you when it's done."])
    expect(run.signal.aborted).toBe(false) // the READ goes on — the answer is not abandoned
    expect(driver.isAwake).toBe(true)
    expect(io.states.at(-1)).toBe('listening') // the room is back

    // Minutes later the answer lands — spoken, not lost.
    run.emit({ kind: 'text', delta: 'Your deploy is green. ' })
    run.emit({ kind: 'completed' })
    await vi.advanceTimersByTimeAsync(10)
    expect(synthesizer.spoken).toEqual([
      "Still working on that — I'll tell you when it's done.",
      'Your deploy is green.',
    ])
  })

  it('the watchdog measures SILENCE — a turn that keeps talking never trips it, and its end is quiet', async () => {
    vi.useFakeTimers()
    const brain = controllableBrain()
    const { driver, synthesizer } = buildDriver(['hey vynel narrate'], brain.runTurn, {
      turnWatchdogMs: 1_000,
    })
    await driver.pushAudio(chunk())
    const run = brain.runs[0]!
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(800)
      run.emit({ kind: 'text', delta: `Step ${i}. ` })
    }
    run.emit({ kind: 'completed' })
    await vi.advanceTimersByTimeAsync(10)
    expect(synthesizer.spoken).toEqual(['Step 0.', 'Step 1.', 'Step 2.', 'Step 3.', 'Step 4.'])
  })

  it('a new utterance after the watchdog barges in on the background turn — it is never queued behind it', async () => {
    vi.useFakeTimers()
    const brain = controllableBrain()
    const { driver, interruptTurn } = buildDriver(['hey vynel take forever', 'new question'], brain.runTurn, {
      turnWatchdogMs: 1_000,
    })
    await driver.pushAudio(chunk())
    brain.runs[0]!.emit({ kind: 'session', sessionId: 's-bg' })
    await vi.advanceTimersByTimeAsync(1_001)

    await driver.pushAudio(chunk())
    await vi.advanceTimersByTimeAsync(10)
    expect(interruptTurn).toHaveBeenCalledWith('s-bg')
    expect(brain.runs[1]!.utterance).toBe('new question')
  })

  it('the status says SPEAKING while the late answer plays — not listening', async () => {
    vi.useFakeTimers()
    const brain = controllableBrain()
    const { driver, io } = buildDriver(['hey vynel take forever'], brain.runTurn, {
      turnWatchdogMs: 1_000,
    })
    await driver.pushAudio(chunk())
    const run = brain.runs[0]!
    run.emit({ kind: 'session', sessionId: 's-slow' })
    await vi.advanceTimersByTimeAsync(1_001)
    expect(io.states.at(-1)).toBe('listening') // the notice drained, the room is back
    const afterNotice = io.states.length

    run.emit({ kind: 'text', delta: 'Your deploy is green. ' })
    run.emit({ kind: 'completed' })
    await vi.advanceTimersByTimeAsync(10)
    // The room is handed back but the daemon IS talking — the indicator has to
    // say so, or it reads as listening through the whole answer.
    expect(io.states.slice(afterNotice)).toEqual(['speaking', 'listening'])
  })

  it('a late answer that lands after the daemon fell ASLEEP still reads as speaking', async () => {
    // The real shape of the watchdog path: it fires at five minutes, the idle
    // window closes fifteen seconds later, and the answer lands long after.
    vi.useFakeTimers()
    const brain = controllableBrain()
    const { driver, io } = buildDriver(['hey vynel take forever'], brain.runTurn, {
      turnWatchdogMs: 1_000,
      idleTimeoutMs: 2_000,
    })
    await driver.pushAudio(chunk())
    const run = brain.runs[0]!
    run.emit({ kind: 'session', sessionId: 's-slow' })
    await vi.advanceTimersByTimeAsync(1_001) // the watchdog hands the room back
    await vi.advanceTimersByTimeAsync(2_001) // …and the conversation window closes
    expect(io.states.at(-1)).toBe('idle')
    const afterSleep = io.states.length

    run.emit({ kind: 'text', delta: 'Your deploy is green. ' })
    run.emit({ kind: 'completed' })
    await vi.advanceTimersByTimeAsync(10)
    expect(io.states.slice(afterSleep)).toEqual(['speaking', 'listening'])
  })

  it('a background turn that CRASHES hands the room back and apologises', async () => {
    vi.useFakeTimers()
    const brain = controllableBrain()
    const { driver, io, synthesizer } = buildDriver(['hey vynel take forever'], brain.runTurn, {
      turnWatchdogMs: 1_000,
    })
    await driver.pushAudio(chunk())
    const run = brain.runs[0]!
    run.emit({ kind: 'session', sessionId: 's-crash' })
    await vi.advanceTimersByTimeAsync(1_001)

    // The status surface dies as the late answer's trailing fragment is flushed
    // — a reject on the DETACHED settle, where nothing else would catch it.
    io.failNextSetState = true
    run.emit({ kind: 'text', delta: 'Your deploy is green' }) // no terminator: flushed after the stream
    run.emit({ kind: 'completed' })
    await vi.advanceTimersByTimeAsync(10)

    expect(synthesizer.spoken).toContain('Sorry, I ran into a problem with that.')
    expect(io.states.at(-1)).toBe('listening')
    expect(driver.isAwake).toBe(true)
  })

  it('never fires the watchdog on a turn that answers in time', async () => {
    vi.useFakeTimers()
    const { driver, synthesizer } = buildDriver(['hey vynel quick one'], () => brainSaying('Done.'), {
      turnWatchdogMs: 1_000,
    })

    await driver.pushAudio(chunk())
    await vi.advanceTimersByTimeAsync(10_000)
    expect(synthesizer.spoken).toEqual(['Done.']) // no "still working" line
  })
})

describe('VoiceSessionDriver — the session transcription lane (cloud hearing)', () => {
  it('wake rides the LOCAL recognizer; in-conversation commands ride transcribeCommand', async () => {
    const commandAudio: PcmAudio[] = []
    const utterances: string[] = []
    const { driver, recognizer } = buildDriver(
      ['hey vynel'],
      (utterance) => {
        utterances.push(utterance)
        return brainSaying('Sure.')
      },
      {
        transcribeCommand: async (audio) => {
          commandAudio.push(audio)
          return 'cloud heard this command'
        },
      },
    )

    // The wake segment: local recognizer only — the room never hits the cloud lane.
    await driver.pushAudio(chunk())
    await settle()
    expect(driver.isAwake).toBe(true)
    expect(recognizer.calls).toBe(1)
    expect(commandAudio).toHaveLength(0)

    // The first in-conversation utterance: the session lane transcribes it.
    await driver.pushAudio(chunk())
    await settle()
    expect(commandAudio).toHaveLength(1)
    expect(recognizer.calls).toBe(1) // untouched — no double transcription
    expect(utterances).toContain('cloud heard this command')
  })

  it('a session-lane failure drops the utterance and keeps listening — never a crash', async () => {
    let commandCalls = 0
    const { driver, recognizer } = buildDriver(['hey vynel'], () => brainSaying('Sure.'), {
      transcribeCommand: async () => {
        commandCalls += 1
        if (commandCalls === 1) throw new Error('cloud transcription unreachable')
        return 'heard after the outage'
      },
    })

    await driver.pushAudio(chunk())
    await settle()
    expect(driver.isAwake).toBe(true)

    // The failing utterance: dropped, no rejection escapes pushAudio.
    await expect(driver.pushAudio(chunk())).resolves.toBeUndefined()
    await settle()
    expect(driver.isAwake).toBe(true) // the conversation survived

    // The next utterance is heard normally.
    await driver.pushAudio(chunk())
    await settle()
    expect(commandCalls).toBe(2)
    expect(recognizer.calls).toBe(1) // wake only — the local model never re-entered
  })
})
