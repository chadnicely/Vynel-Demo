import { describe, expect, it, vi } from 'vitest'
import { LineSpeaker, type LineSpeakerIo, type SpokenAudio } from './line-speaker.js'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const audioFor = (): SpokenAudio => ({ samples: new Float32Array([0]), sampleRate: 16_000 })

// Controllable harness: synthesis resolves only when the test says so, and the
// cut can emulate the real sink's behavior (a cut that interrupted playback
// fires the drained signal — output-sink's hadPlayback path).
function speakerHarness(options: { cutFiresDrained?: boolean } = {}) {
  const pendingSynth: Array<() => void> = []
  const events: string[] = []
  let speakerRef: LineSpeaker | null = null
  const io: LineSpeakerIo = {
    synthesize: (sentence) =>
      new Promise((resolve) => {
        events.push(`synth:${sentence}`)
        pendingSynth.push(() => resolve(audioFor()))
      }),
    emitAudio: () => {
      events.push('emit')
    },
    endSpeech: () => {
      events.push('endSpeech')
    },
    cutPlayback: vi.fn(() => {
      events.push('cut')
      if (options.cutFiresDrained === true) speakerRef?.notifyPlaybackDrained()
    }),
  }
  const speaker = new LineSpeaker(io)
  speakerRef = speaker
  return {
    speaker,
    events,
    // A streamed line reaches its synth on a microtask after the push (the
    // loop was parked on the queue), so let that land before resolving.
    resolveSynth: async () => {
      await tick()
      pendingSynth.shift()?.()
      await tick()
    },
  }
}

describe('LineSpeaker', () => {
  it('pipelines sentences in order and waits for the true device drain', async () => {
    const { speaker, events, resolveSynth } = speakerHarness()

    const outcome = speaker.speakLine('One. Two.')
    await resolveSynth()
    await resolveSynth()
    expect(events).toEqual(['synth:One.', 'emit', 'synth:Two.', 'emit', 'endSpeech'])

    let resolved = false
    void outcome.then(() => {
      resolved = true
    })
    await tick()
    expect(resolved).toBe(false) // endSpeech sent, still waiting on the device

    speaker.notifyPlaybackDrained()
    expect(await outcome).toEqual({ spoke: true, cancelled: false })
  })

  it('cancel during synthesis stops the line: no further emit, no trailing endSpeech', async () => {
    const { speaker, events, resolveSynth } = speakerHarness()

    const outcome = speaker.speakLine('One. Two.')
    await resolveSynth() // sentence One emitted; synth for Two now pending
    speaker.cancel()
    await resolveSynth() // Two's synthesis lands AFTER the cancel

    expect(await outcome).toEqual({ spoke: true, cancelled: true })
    expect(events).toContain('cut')
    expect(events.filter((event) => event === 'emit')).toHaveLength(1)
    expect(events).not.toContain('endSpeech')
  })

  it('cancel during the drain wait resolves through the cut-drained round-trip', async () => {
    const { speaker, resolveSynth } = speakerHarness({ cutFiresDrained: true })

    const outcome = speaker.speakLine('One.')
    await resolveSynth() // emitted + endSpeech; now awaiting the drain
    speaker.cancel()

    expect(await outcome).toEqual({ spoke: true, cancelled: true })
  })

  it("a cancelled line's stray drained signal never satisfies the NEXT line's wait", async () => {
    const { speaker, resolveSynth } = speakerHarness({ cutFiresDrained: true })

    const first = speaker.speakLine('One. Two.')
    await resolveSynth() // One emitted; Two's synth pending
    speaker.cancel() // cut fires drained with NO waiter → pending flag set
    await resolveSynth()
    expect(await first).toEqual({ spoke: true, cancelled: true })

    const second = speaker.speakLine('Three.')
    await resolveSynth()
    let resolved = false
    void second.then(() => {
      resolved = true
    })
    await tick()
    expect(resolved).toBe(false) // the stale flag was reset — still waiting

    speaker.notifyPlaybackDrained()
    expect(await second).toEqual({ spoke: true, cancelled: false })
  })

  it('refuses a second concurrent line — callers must serialize', async () => {
    const { speaker, resolveSynth } = speakerHarness()

    const first = speaker.speakLine('One.')
    await expect(speaker.speakLine('Two.')).rejects.toThrow('serialize')

    await resolveSynth()
    speaker.notifyPlaybackDrained()
    await first
  })

  it('an empty line speaks nothing and never touches the device', async () => {
    const { speaker, events } = speakerHarness()

    expect(await speaker.speakLine('   ')).toEqual({ spoke: false, cancelled: false })
    expect(events).toEqual([])
  })

  it('exposes isSpeaking across the line lifecycle', async () => {
    const { speaker, resolveSynth } = speakerHarness()

    expect(speaker.isSpeaking).toBe(false)
    const outcome = speaker.speakLine('One.')
    expect(speaker.isSpeaking).toBe(true)
    await resolveSynth()
    speaker.notifyPlaybackDrained()
    await outcome
    expect(speaker.isSpeaking).toBe(false)
  })
})

describe('LineSpeaker — a streamed line (sentences arrive while it speaks)', () => {
  it('speaks the first sentence as soon as it is pushed — long before the line ends', async () => {
    const { speaker, events, resolveSynth } = speakerHarness()

    const line = speaker.speakStreamed()
    line.push('One.')
    await resolveSynth()
    expect(events).toEqual(['synth:One.', 'emit']) // heard while the model is still writing
    expect(speaker.isSpeaking).toBe(true)

    line.push('Two.')
    await resolveSynth()
    expect(events).toEqual(['synth:One.', 'emit', 'synth:Two.', 'emit'])
    expect(events).not.toContain('endSpeech') // the line is still open

    line.end()
    await tick()
    expect(events.at(-1)).toBe('endSpeech')
    speaker.notifyPlaybackDrained()
    expect(await line.outcome).toEqual({ spoke: true, cancelled: false })
    expect(speaker.isSpeaking).toBe(false)
  })

  it('pipelines: the next sentence synthesizes while the previous one plays, in order', async () => {
    const { speaker, events, resolveSynth } = speakerHarness()

    const line = speaker.speakStreamed()
    line.push('One.')
    line.push('Two.')
    line.push('Three.')
    line.end()
    await resolveSynth()
    await resolveSynth()
    await resolveSynth()
    expect(events).toEqual(['synth:One.', 'emit', 'synth:Two.', 'emit', 'synth:Three.', 'emit', 'endSpeech'])
  })

  it('cancel mid-line cuts playback, drops what was still to come, and settles the outcome', async () => {
    const { speaker, events, resolveSynth } = speakerHarness({ cutFiresDrained: true })

    const line = speaker.speakStreamed()
    line.push('One.')
    await resolveSynth() // One is on the device; the loop waits for more
    line.cancel()
    line.push('Two.') // arrives after the cut — ignored
    line.end()

    expect(await line.outcome).toEqual({ spoke: true, cancelled: true })
    expect(events).toEqual(['synth:One.', 'emit', 'cut'])
    expect(speaker.isSpeaking).toBe(false)
  })

  it("a finished line's stale handle cannot cut the next line", async () => {
    const { speaker, events, resolveSynth } = speakerHarness()

    const first = speaker.speakStreamed()
    first.end()
    expect(await first.outcome).toEqual({ spoke: false, cancelled: false })

    const second = speaker.speakStreamed()
    second.push('Two.')
    first.cancel() // stale
    await resolveSynth()
    expect(events).toEqual(['synth:Two.', 'emit'])
    second.end()
    await tick()
    speaker.notifyPlaybackDrained()
    expect(await second.outcome).toEqual({ spoke: true, cancelled: false })
  })

  it('refuses to open while a line is in flight, and an empty line never touches the device', async () => {
    const { speaker, events } = speakerHarness()

    const line = speaker.speakStreamed()
    expect(() => speaker.speakStreamed()).toThrow('serialize')
    await expect(speaker.speakLine('Two.')).rejects.toThrow('serialize')
    line.end()
    expect(await line.outcome).toEqual({ spoke: false, cancelled: false })
    expect(events).toEqual([])
  })
})
