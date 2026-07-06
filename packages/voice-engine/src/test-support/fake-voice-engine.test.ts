import { describe, expect, it } from 'vitest'
import { FakeVoiceEngine } from './fake-voice-engine.js'

describe('FakeVoiceEngine', () => {
  it('records what was spoken, in order', async () => {
    const engine = new FakeVoiceEngine()
    await engine.synthesize('hello')
    await engine.synthesize('world')
    expect(engine.spoken).toEqual(['hello', 'world'])
  })

  it('returns deterministic non-empty audio sized to the text', async () => {
    const engine = new FakeVoiceEngine()
    const short = await engine.synthesize('hi')
    const long = await engine.synthesize('a much longer utterance than the first')
    expect(short.samples.length).toBeGreaterThan(0)
    expect(long.samples.length).toBeGreaterThan(short.samples.length)
    expect(short.sampleRate).toBe(24000)
  })

  it('shortens audio as speed increases', async () => {
    const engine = new FakeVoiceEngine()
    const natural = await engine.synthesize('same text', { speed: 1 })
    const fast = await engine.synthesize('same text', { speed: 2 })
    expect(fast.samples.length).toBeLessThan(natural.samples.length)
  })
})
