import { describe, expect, it } from 'vitest'
import {
  fetchVoiceSelection,
  planVoiceReload,
  readVoiceSelection,
  settleVoiceSelectionWithEngine,
  type VoiceSelection,
} from './voice-selection.js'

const FALLBACK: VoiceSelection = {
  ttsSource: 'local',
  sttSource: 'web-speech',
  ttsModelId: 'kokoro',
  sttModelId: 'moonshine-base',
  speakerId: 0,
}

function answering(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('readVoiceSelection', () => {
  it('takes the user’s pick from the engine’s preferences door', async () => {
    const urls: string[] = []
    const answer = answering({ voiceTtsModelId: 'piper-lessac', voiceSttModelId: 'moonshine-tiny', voiceSpeakerId: 3 })
    const recording = ((url: string, init?: RequestInit) => {
      urls.push(url)
      return answer(url, init)
    }) as unknown as typeof fetch
    const selection = await readVoiceSelection({ apiUrl: 'http://engine', fallback: FALLBACK, fetch: recording })
    expect(urls).toEqual(['http://engine/users/me/preferences'])
    expect(selection).toEqual({
      ...FALLBACK,
      ttsModelId: 'piper-lessac',
      sttModelId: 'moonshine-tiny',
      speakerId: 3,
    })
  })

  it('keeps the fallback per field for anything the engine does not answer or the catalog lacks', async () => {
    const selection = await readVoiceSelection({
      apiUrl: 'http://engine',
      fallback: FALLBACK,
      fetch: answering({ voiceTtsModelId: 'retired-voice', voiceSpeakerId: -2 }),
    })
    expect(selection).toEqual(FALLBACK)
  })

  // The daemon may boot before the engine — it must come up on env alone.
  it('is the fallback whole when the engine is down or errors, never a throw', async () => {
    const refused = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await readVoiceSelection({ apiUrl: 'http://engine', fallback: FALLBACK, fetch: refused })).toEqual(FALLBACK)
    expect(
      await readVoiceSelection({ apiUrl: 'http://engine', fallback: FALLBACK, fetch: answering('nope', 500) }),
    ).toEqual(FALLBACK)
  })
})

describe('planVoiceReload', () => {
  it('swaps only the engines whose model changed and is installed; the speaker always follows', () => {
    const plan = planVoiceReload(
      FALLBACK,
      { ...FALLBACK, ttsModelId: 'piper-lessac', sttModelId: 'moonshine-base', speakerId: 4 },
      () => true,
    )
    expect(plan).toEqual({
      selection: { ...FALLBACK, ttsModelId: 'piper-lessac', sttModelId: 'moonshine-base', speakerId: 4 },
      swapTts: true,
      swapStt: false,
      missing: [],
    })
  })

  it('keeps the current engine for a picked model that is not on the disk, and says so', () => {
    const plan = planVoiceReload(
      FALLBACK,
      { ...FALLBACK, ttsModelId: 'piper-lessac', sttModelId: 'moonshine-tiny', speakerId: 0 },
      (id) => id === 'moonshine-tiny',
    )
    expect(plan.selection).toEqual({ ...FALLBACK, sttModelId: 'moonshine-tiny' })
    expect(plan.swapTts).toBe(false)
    expect(plan.swapStt).toBe(true)
    expect(plan.missing).toEqual(['piper-lessac'])
  })
})

describe('fetchVoiceSelection (the strict read)', () => {
  it('answers null when the engine is unreachable or not ok — never the fallback', async () => {
    const refused = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await fetchVoiceSelection({ apiUrl: 'http://engine', fallback: FALLBACK, fetch: refused })).toBeNull()
    expect(
      await fetchVoiceSelection({ apiUrl: 'http://engine', fallback: FALLBACK, fetch: answering('nope', 500) }),
    ).toBeNull()
  })
})

describe('settleVoiceSelectionWithEngine', () => {
  it('keeps asking until the engine answers once, applies exactly once, then stops', async () => {
    const applied: VoiceSelection[] = []
    let reads = 0
    const settle = settleVoiceSelectionWithEngine({
      read: async () => {
        reads += 1
        return reads < 3 ? null : { ...FALLBACK, ttsSource: 'elevenlabs' }
      },
      apply: (selection) => applied.push(selection),
      sleep: async () => {},
    })
    await settle.done
    expect(reads).toBe(3)
    expect(applied).toHaveLength(1)
    expect(applied[0]!.ttsSource).toBe('elevenlabs')
  })

  it('cancel stops the loop without applying', async () => {
    const applied: VoiceSelection[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const settle = settleVoiceSelectionWithEngine({
      read: async () => ({ ...FALLBACK }),
      apply: (selection) => applied.push(selection),
      sleep: () => gate,
    })
    settle.cancel()
    release()
    await settle.done
    expect(applied).toHaveLength(0)
  })
})
