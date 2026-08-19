import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { LineSpeaker, SpokenEchoFilter, type SpokenAudio } from '@vynel/voice'
import { SpeechLane } from './speech-lane.js'
import { SpokenBrainTurn } from './spoken-brain-turn.js'
import type { VoiceBrainClient, VoiceBrainEvent } from './voice-session-types.js'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await tick()
}

/** One controllable brain run: the test emits events and ends the stream. */
function brainRun() {
  const queue: VoiceBrainEvent[] = []
  let ended = false
  let wake: (() => void) | null = null
  let signalSeen: AbortSignal | null = null
  const notify = (): void => {
    const w = wake
    wake = null
    w?.()
  }
  const runTurn = (_utterance: string, signal?: AbortSignal): AsyncIterable<VoiceBrainEvent> => ({
    [Symbol.asyncIterator]() {
      signalSeen = signal ?? null
      signal?.addEventListener('abort', notify, { once: true })
      return {
        async next(): Promise<IteratorResult<VoiceBrainEvent>> {
          for (;;) {
            if (queue.length > 0) return { value: queue.shift()!, done: false }
            if (ended || signal?.aborted === true) return { value: undefined, done: true }
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
  return {
    runTurn,
    emit: (event: VoiceBrainEvent) => {
      queue.push(event)
      notify()
    },
    end: () => {
      ended = true
      notify()
    },
    get aborted() {
      return signalSeen?.aborted === true
    },
  }
}

function turnHarness(
  options: {
    turnWatchdogMs?: number
    interrupt?: () => Promise<boolean>
    onSpeaking?: () => void
  } = {},
) {
  const run = brainRun()
  const interruptTurn = vi.fn(options.interrupt ?? (async () => true))
  const brain: VoiceBrainClient = { runTurn: run.runTurn, interruptTurn }
  const spoken: string[] = []
  const cut = vi.fn()
  let speakerRef: LineSpeaker | null = null
  const speaker = new LineSpeaker({
    synthesize: (sentence): Promise<SpokenAudio> => {
      spoken.push(sentence)
      return Promise.resolve({ samples: new Float32Array(1), sampleRate: 16_000 })
    },
    emitAudio: () => {},
    endSpeech: () => speakerRef?.notifyPlaybackDrained(),
    cutPlayback: () => {
      cut()
      speakerRef?.notifyPlaybackDrained()
    },
  })
  speakerRef = speaker
  const lane = new SpeechLane()
  const echoFilter = new SpokenEchoFilter()
  const speakingStarted = vi.fn(options.onSpeaking)
  const turn = new SpokenBrainTurn({
    logger: pino({ level: 'silent' }),
    brain,
    echoFilter,
    turnWatchdogMs: options.turnWatchdogMs ?? 0,
    onSpeaking: speakingStarted,
    openSpeech: () =>
      new Promise((resolve) => {
        void lane.reserve(() => {
          const line = speaker.speakStreamed()
          resolve(line)
          return line.outcome
        })
      }),
  })
  return { turn, run, spoken, cut, interruptTurn, echoFilter, speakingStarted, lane, speaker }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SpokenBrainTurn', () => {
  it('speaks the streamed text chunk by chunk, stripped, and remembers it as ONE echo line', async () => {
    const h = turnHarness()
    const settled = h.turn.run('status?')
    h.run.emit({ kind: 'session', sessionId: 's-1' })
    h.run.emit({ kind: 'text', delta: '**All green.** Nothing to ' })
    await settle()
    expect(h.spoken).toEqual(['All green.'])
    expect(h.speakingStarted).toHaveBeenCalledTimes(1)
    expect(h.turn.hasSpoken).toBe(true)

    h.run.emit({ kind: 'text', delta: 'worry about.' })
    h.run.emit({ kind: 'completed' })
    expect(await settled).toBe('completed')
    expect(h.spoken).toEqual(['All green.', 'Nothing to worry about.'])
    // The whole reply is one line, so an echo straddling its chunks still matches.
    expect(h.echoFilter.isEcho('green nothing to worry')).toBe(true)
    expect(h.echoFilter.isEcho('what about tomorrow')).toBe(false)
  })

  it('barge-in with the session known: cuts, stops reading, interrupts server-side, resolves interrupted', async () => {
    const h = turnHarness()
    const settled = h.turn.run('long one')
    h.run.emit({ kind: 'session', sessionId: 's-1' })
    h.run.emit({ kind: 'text', delta: 'Part one. ' })
    await settle()

    await h.turn.bargeIn()
    expect(h.cut).toHaveBeenCalled()
    expect(h.run.aborted).toBe(true)
    expect(h.interruptTurn).toHaveBeenCalledWith('s-1')
    expect(await settled).toBe('interrupted')
    expect(h.spoken).toEqual(['Part one.'])
  })

  it('barge-in before the session is known: stops the server turn the moment the id arrives', async () => {
    const h = turnHarness()
    const settled = h.turn.run('long one')
    h.run.emit({ kind: 'queued' })
    await settle()

    await h.turn.bargeIn()
    expect(h.interruptTurn).not.toHaveBeenCalled()
    h.run.emit({ kind: 'text', delta: 'Ignored after the barge-in. ' })
    h.run.emit({ kind: 'session', sessionId: 's-late' })
    expect(await settled).toBe('interrupted')
    expect(h.interruptTurn).toHaveBeenCalledWith('s-late')
    expect(h.spoken).toEqual([])
  })

  it('barge-in after the stream ended only cuts the speech — no server stop', async () => {
    const h = turnHarness()
    const settled = h.turn.run('quick one')
    h.run.emit({ kind: 'session', sessionId: 's-1' })
    h.run.emit({ kind: 'text', delta: 'Done. ' })
    h.run.emit({ kind: 'completed' })
    await settle()
    expect(await settled).toBe('completed')

    await h.turn.bargeIn()
    expect(h.interruptTurn).not.toHaveBeenCalled()
  })

  it('a failed interrupt is logged, never thrown — the turn still settles', async () => {
    const h = turnHarness({ interrupt: async () => { throw new Error('api down') } })
    const settled = h.turn.run('x')
    h.run.emit({ kind: 'session', sessionId: 's-1' })
    await settle()
    await expect(h.turn.bargeIn()).resolves.toBeUndefined()
    expect(await settled).toBe('interrupted')
  })

  it('the watchdog fires on silence only, and reports whether anything was spoken', async () => {
    vi.useFakeTimers()
    const h = turnHarness({ turnWatchdogMs: 1_000 })
    const settled = h.turn.run('slow one')
    await vi.advanceTimersByTimeAsync(900)
    h.run.emit({ kind: 'text', delta: 'Working on it. ' })
    await vi.advanceTimersByTimeAsync(900)
    expect(h.turn.watchdogFired).toBe(false) // the text reset the clock

    await vi.advanceTimersByTimeAsync(200)
    expect(h.turn.watchdogFired).toBe(true)
    expect(h.turn.hasSpoken).toBe(true)
    await expect(h.turn.whenWatchdogFired).resolves.toBeUndefined()

    h.run.emit({ kind: 'text', delta: 'Done now. ' })
    h.run.emit({ kind: 'completed' })
    await vi.advanceTimersByTimeAsync(10)
    expect(await settled).toBe('completed')
    expect(h.spoken).toEqual(['Working on it.', 'Done now.'])
  })

  it('a failed turn speaks what it had, then settles failed; an empty turn speaks nothing', async () => {
    const h = turnHarness()
    const settled = h.turn.run('x')
    h.run.emit({ kind: 'text', delta: 'Let me check your' })
    h.run.emit({ kind: 'failed', message: 'engine down' })
    expect(await settled).toBe('failed')
    expect(h.spoken).toEqual(['Let me check your'])

    const quiet = turnHarness()
    const quietSettled = quiet.turn.run('y')
    quiet.run.emit({ kind: 'completed' })
    expect(await quietSettled).toBe('completed')
    expect(quiet.spoken).toEqual([])
    expect(quiet.turn.hasSpoken).toBe(false)
  })

  it('NEVER rejects — a throwing speaker seam settles as a failed outcome', async () => {
    // The driver watches a watchdog-released turn DETACHED: a rejection there
    // is an unhandled one, and the room never comes back from it.
    const h = turnHarness({
      onSpeaking: () => {
        throw new Error('status surface is gone')
      },
    })

    const settled = h.turn.run('status?')
    // No terminator, so the only chunk is flushed AFTER the stream ends — the
    // one place a throw used to escape run()'s own try.
    h.run.emit({ kind: 'text', delta: 'The deploy finished a moment ago' })
    h.run.emit({ kind: 'completed' })

    await expect(settled).resolves.toBe('failed')
  })
})
