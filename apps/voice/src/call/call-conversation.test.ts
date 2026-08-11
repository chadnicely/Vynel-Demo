import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { buildNoteFlushMessage, LineSpeaker, type CallMode } from '@vynel/voice'
import type { PcmAudio, VoiceActivityDetector } from '@vynel/voice-engine'
import type { VoiceBrainEvent } from '../loop/voice-session-types.js'
import type { CallSessionClient } from './call-session-client.js'
import { CallConversation } from './call-conversation.js'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick()
}

// Segments are distinguished by sample count; transcripts map from it.
const segment = (id: number): PcmAudio => ({ samples: new Float32Array(id), sampleRate: 16_000 })

async function* eventsOf(events: VoiceBrainEvent[]): AsyncIterable<VoiceBrainEvent> {
  for (const event of events) yield event
}

const replyOf = (text: string): VoiceBrainEvent[] => [
  { kind: 'text', delta: text },
  { kind: 'completed' },
]

interface HarnessOptions {
  mode: CallMode
  transcripts: Record<number, string>
  /** Reply events per turn, consumed in call order. Default: reply 'Done.'. */
  turnReplies?: VoiceBrainEvent[][]
  /** Hold synthesis pending until released — makes isSpeaking observable. */
  manualSynth?: boolean
  /** Hold transcription pending until released — makes the stop window observable. */
  manualTranscribe?: boolean
}

function conversationHarness(options: HarnessOptions) {
  const pendingSegments: PcmAudio[] = []
  const vad: VoiceActivityDetector = {
    push: () => pendingSegments.splice(0),
    flush: () => [],
  }
  const turnMessages: string[] = []
  const replies = [...(options.turnReplies ?? [])]
  const sessionClient: CallSessionClient = {
    createCallSession: vi.fn(async () => ({ sessionId: 'sess-1' })),
    runCallTurn: vi.fn((_sessionId: string, message: string) => {
      turnMessages.push(message)
      return eventsOf(replies.shift() ?? replyOf('Done.'))
    }),
  }

  const spokenSentences: string[] = []
  const synthReleases: Array<() => void> = []
  const cutPlayback = vi.fn(() => {
    // Emulate the real sink: a cut that interrupted playback fires drained.
    speaker.notifyPlaybackDrained()
  })
  const speaker: LineSpeaker = new LineSpeaker({
    synthesize: (sentence) => {
      spokenSentences.push(sentence)
      if (options.manualSynth === true) {
        return new Promise((resolve) =>
          synthReleases.push(() => resolve({ samples: new Float32Array(1), sampleRate: 16_000 })),
        )
      }
      return Promise.resolve({ samples: new Float32Array(1), sampleRate: 16_000 })
    },
    emitAudio: () => {},
    endSpeech: () => {
      // The device finishes "playing" on the next microtask.
      queueMicrotask(() => speaker.notifyPlaybackDrained())
    },
    cutPlayback,
  })

  const transcribeReleases: Array<() => void> = []
  const conversation = new CallConversation({
    logger: pino({ level: 'silent' }),
    callId: 'call-1',
    mode: options.mode,
    sessionId: 'sess-1',
    assistantName: 'Vynel',
    vad,
    transcribe: (audio) => {
      const transcript = options.transcripts[audio.samples.length] ?? ''
      if (options.manualTranscribe === true) {
        return new Promise((resolve) => transcribeReleases.push(() => resolve(transcript)))
      }
      return Promise.resolve(transcript)
    },
    lineSpeaker: speaker,
    sessionClient,
  })

  return {
    conversation,
    turnMessages,
    spokenSentences,
    cutPlayback,
    releaseSynth: () => synthReleases.shift()?.(),
    releaseTranscribe: () => transcribeReleases.shift()?.(),
    hear: (id: number) => {
      pendingSegments.push(segment(id))
      conversation.pushAudio(segment(0))
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CallConversation — participant mode', () => {
  it('runs a turn on every real utterance and speaks the stripped reply', async () => {
    const harness = conversationHarness({
      mode: 'participant',
      transcripts: { 1: 'so what is the deploy status?' },
      turnReplies: [replyOf('**Checking.** All green.')],
    })

    harness.hear(1)
    await settle()

    expect(harness.turnMessages).toEqual(['so what is the deploy status?'])
    expect(harness.spokenSentences).toEqual(['Checking.', 'All green.'])
  })

  it('incoming speech cuts the in-flight line and the newest utterance wins', async () => {
    const harness = conversationHarness({
      mode: 'participant',
      transcripts: { 1: 'first question', 2: 'actually, different question' },
      turnReplies: [replyOf('Long first answer.'), replyOf('Second answer.')],
      manualSynth: true,
    })

    harness.hear(1)
    await settle() // turn 1 replied; speech is now pending in synthesis
    expect(harness.spokenSentences).toEqual(['Long first answer.'])

    harness.hear(2) // human talks over Vynel
    expect(harness.cutPlayback).toHaveBeenCalled()
    harness.releaseSynth()
    await settle()

    expect(harness.turnMessages).toEqual(['first question', 'actually, different question'])
  })

  it('a failed turn is acknowledged aloud instead of silence', async () => {
    const harness = conversationHarness({
      mode: 'participant',
      transcripts: { 1: 'hello?' },
      turnReplies: [[{ kind: 'failed', message: 'engine down' }]],
    })

    harness.hear(1)
    await settle()

    expect(harness.spokenSentences.join(' ')).toContain('Sorry')
  })
})

describe('CallConversation — notetaker mode', () => {
  it('batches unaddressed talk into one flush turn and stays silent on the sentinel', async () => {
    const transcripts: Record<number, string> = {}
    for (let i = 1; i <= 8; i++) transcripts[i] = `point number ${i}`
    const harness = conversationHarness({
      mode: 'notetaker',
      transcripts,
      turnReplies: [replyOf('noted')],
    })

    for (let i = 1; i <= 7; i++) harness.hear(i)
    await settle()
    expect(harness.turnMessages).toEqual([]) // still listening, no turn

    harness.hear(8)
    await settle()
    expect(harness.turnMessages).toEqual([
      buildNoteFlushMessage([1, 2, 3, 4, 5, 6, 7, 8].map((i) => `point number ${i}`)),
    ])
    expect(harness.spokenSentences).toEqual([]) // 'noted' → silence
  })

  it('speaks up when a flush reply is substantive', async () => {
    const transcripts: Record<number, string> = {}
    for (let i = 1; i <= 8; i++) transcripts[i] = `filler ${i}`
    const harness = conversationHarness({
      mode: 'notetaker',
      transcripts,
      turnReplies: [replyOf('Heads up — that deadline conflicts with the freeze.')],
    })

    for (let i = 1; i <= 8; i++) harness.hear(i)
    await settle()

    expect(harness.spokenSentences.join(' ')).toContain('Heads up')
  })

  it('an addressed utterance responds immediately with the full transcript', async () => {
    const harness = conversationHarness({
      mode: 'notetaker',
      transcripts: { 1: 'Vynel, what did we decide on pricing?' },
      turnReplies: [replyOf('You settled on tiered pricing.')],
    })

    harness.hear(1)
    await settle()

    expect(harness.turnMessages).toEqual(['Vynel, what did we decide on pricing?'])
    expect(harness.spokenSentences).toEqual(['You settled on tiered pricing.'])
  })

  it('flushes a sparse note after the batch window elapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = conversationHarness({
      mode: 'notetaker',
      transcripts: { 1: 'one lonely remark' },
      turnReplies: [replyOf('noted')],
    })

    harness.hear(1)
    await vi.advanceTimersByTimeAsync(0) // let transcription/decision settle
    expect(harness.turnMessages).toEqual([])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.turnMessages).toEqual([buildNoteFlushMessage(['one lonely remark'])])
  })

  it('a failed flush turn stays silent — it must not interrupt the call', async () => {
    const transcripts: Record<number, string> = {}
    for (let i = 1; i <= 8; i++) transcripts[i] = `filler ${i}`
    const harness = conversationHarness({
      mode: 'notetaker',
      transcripts,
      turnReplies: [[{ kind: 'failed', message: 'engine down' }]],
    })

    for (let i = 1; i <= 8; i++) harness.hear(i)
    await settle()

    expect(harness.spokenSentences).toEqual([])
  })
})

describe('CallConversation — direct speech (the conductor’s voice)', () => {
  it('speaks a direct line immediately when idle', async () => {
    const harness = conversationHarness({ mode: 'notetaker', transcripts: {} })

    harness.conversation.speakDirect('Heads up — Vynel has joined and is taking notes.')
    await settle()

    expect(harness.spokenSentences.join(' ')).toContain('has joined')
  })

  it('a direct line queued during a turn plays after it — ahead of a pending respond', async () => {
    const harness = conversationHarness({
      mode: 'participant',
      transcripts: { 1: 'first question', 2: 'second question' },
      turnReplies: [replyOf('First answer.'), replyOf('Second answer.')],
      manualSynth: true,
    })

    harness.hear(1)
    await settle() // turn 1's reply is mid-synthesis — turn flag held
    harness.conversation.speakDirect('We need to wrap in five minutes.')
    harness.hear(2) // a pending respond queues too
    harness.releaseSynth() // finish turn 1's speech
    await settle()
    harness.releaseSynth() // finish the direct line
    await settle()
    harness.releaseSynth() // finish turn 2's reply
    await settle()

    const spoken = harness.spokenSentences
    expect(spoken.indexOf('We need to wrap in five minutes.')).toBeGreaterThan(
      spoken.indexOf('First answer.'),
    )
    expect(spoken.indexOf('We need to wrap in five minutes.')).toBeLessThan(
      spoken.indexOf('Second answer.'),
    )
  })

  it('direct lines are dropped once stopped', async () => {
    const harness = conversationHarness({ mode: 'notetaker', transcripts: {} })

    harness.conversation.stop()
    harness.conversation.speakDirect('too late')
    await settle()

    expect(harness.spokenSentences).toEqual([])
  })
})

describe('CallConversation — lifecycle', () => {
  it('a stop landing mid-transcription discards the transcript — no turn into a dead session', async () => {
    const harness = conversationHarness({
      mode: 'participant',
      transcripts: { 1: 'late words after the call ended' },
      manualTranscribe: true,
    })

    harness.hear(1)
    await tick() // transcription in flight
    harness.conversation.stop()
    harness.releaseTranscribe()
    await settle()

    expect(harness.turnMessages).toEqual([])
  })

  it('stop drops queued work and refuses new audio', async () => {
    const harness = conversationHarness({
      mode: 'participant',
      transcripts: { 1: 'anyone there?' },
    })

    harness.conversation.stop()
    harness.hear(1)
    await settle()

    expect(harness.turnMessages).toEqual([])
    expect(harness.spokenSentences).toEqual([])
  })
})
