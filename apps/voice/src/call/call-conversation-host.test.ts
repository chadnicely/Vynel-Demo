import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import type { OutputSink } from '../audio/output-sink.js'
import type { CallDescriptor } from './call-registry.js'
import type { CallSessionClient } from './call-session-client.js'
import { createCallConversationHost } from './call-conversation-host.js'

const pcm: PcmAudio = { samples: new Float32Array(4), sampleRate: 16_000 }

function descriptorWith(overrides: Partial<CallDescriptor>): CallDescriptor {
  return {
    callId: 'call-1',
    label: 'standup',
    mode: 'notetaker',
    startedAtIso: '2026-08-11T21:00:00.000Z',
    ...overrides,
  }
}

function hostHarness() {
  const transcribe = vi.fn(async () => 'a remark')
  const warn = vi.fn()
  const logger = pino({ level: 'silent' })
  vi.spyOn(logger, 'warn').mockImplementation(warn as never)
  const sink: OutputSink = { emitAudio: vi.fn(), endSpeech: vi.fn(), cutPlayback: vi.fn(), stop: vi.fn() }
  const sessionClient: CallSessionClient = {
    createCallSession: vi.fn(async () => ({ sessionId: 'sess-1' })),
    runCallTurn: vi.fn(),
  }
  const host = createCallConversationHost({
    logger,
    assistantName: 'Vynel',
    sessionClient,
    // One segment per push keeps the routing observable via `transcribe`.
    createVad: () => ({ push: (audio) => [audio], flush: () => [] }),
    transcribe,
    synthesize: vi.fn(async () => ({ samples: new Float32Array(1), sampleRate: 16_000 })),
    findCallSink: () => sink,
  })
  return { host, transcribe, warn }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createCallConversationHost', () => {
  it('routes call audio into the call’s conversation once started', async () => {
    const { host, transcribe } = hostHarness()

    host.onCallStarted(descriptorWith({ sessionId: 'sess-1' }))
    host.onCallAudio('call-1', pcm)
    await settle()

    expect(transcribe).toHaveBeenCalledTimes(1)
  })

  it('a call without a session gets audio but no brain — warned, not attached', async () => {
    const { host, transcribe, warn } = hostHarness()

    host.onCallStarted(descriptorWith({}))
    host.onCallAudio('call-1', pcm)
    await settle()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('an ended call stops hearing', async () => {
    const { host, transcribe } = hostHarness()

    host.onCallStarted(descriptorWith({ sessionId: 'sess-1' }))
    host.onCallEnded('call-1')
    host.onCallAudio('call-1', pcm)
    await settle()

    expect(transcribe).not.toHaveBeenCalled()
  })

  it('speakIntoCall reaches a live conversation and reports a missing one', () => {
    const { host } = hostHarness()

    expect(host.speakIntoCall('call-1', 'hello')).toBe(false) // not started yet
    host.onCallStarted(descriptorWith({ sessionId: 'sess-1' }))
    expect(host.speakIntoCall('call-1', 'hello')).toBe(true)
    host.onCallEnded('call-1')
    expect(host.speakIntoCall('call-1', 'hello')).toBe(false)
  })

  it('stopAll tears every conversation down (shutdown path)', async () => {
    const { host, transcribe } = hostHarness()

    host.onCallStarted(descriptorWith({ sessionId: 'sess-1' }))
    host.stopAll()
    host.onCallAudio('call-1', pcm)
    await settle()

    expect(transcribe).not.toHaveBeenCalled()
  })
})
