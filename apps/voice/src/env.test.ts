import { describe, expect, it } from 'vitest'
import { EnvSchema, applyDeprecatedVoiceEnvAliases } from './env.js'

// The display-dock rename kept the four `VYNEL_VOICE_JARVIS_*` knobs working
// for one release. These pin the contract that promise rests on.
describe('applyDeprecatedVoiceEnvAliases', () => {
  it('fills a new knob from its deprecated name', () => {
    const merged = applyDeprecatedVoiceEnvAliases({
      VYNEL_VOICE_JARVIS_WINDOW: '0',
      VYNEL_VOICE_JARVIS_URL: 'http://localhost:1234/display-dock',
      VYNEL_VOICE_JARVIS_BROWSER: 'msedge',
      VYNEL_VOICE_JARVIS_APP: 'C:\vynel\vynel-desktop.exe',
    })

    expect(merged['VYNEL_VOICE_DOCK_WINDOW']).toBe('0')
    expect(merged['VYNEL_VOICE_DOCK_URL']).toBe('http://localhost:1234/display-dock')
    expect(merged['VYNEL_VOICE_DOCK_BROWSER']).toBe('msedge')
    expect(merged['VYNEL_VOICE_DOCK_APP']).toBe('C:\vynel\vynel-desktop.exe')
  })

  it('lets the NEW name win when both are set — the explicit value is current intent', () => {
    const merged = applyDeprecatedVoiceEnvAliases({
      VYNEL_VOICE_JARVIS_WINDOW: '0',
      VYNEL_VOICE_DOCK_WINDOW: '1',
    })

    expect(merged['VYNEL_VOICE_DOCK_WINDOW']).toBe('1')
  })

  it('never mutates the source object', () => {
    const raw = { VYNEL_VOICE_JARVIS_BROWSER: 'msedge' }
    applyDeprecatedVoiceEnvAliases(raw)

    expect(raw).toEqual({ VYNEL_VOICE_JARVIS_BROWSER: 'msedge' })
  })

  it('leaves the schema defaults in place when neither name is set', () => {
    const env = EnvSchema.parse(applyDeprecatedVoiceEnvAliases({}))

    expect(env.VYNEL_VOICE_DOCK_WINDOW).toBe('1')
    expect(env.VYNEL_VOICE_DOCK_URL).toContain('/display-dock')
    expect(env.VYNEL_VOICE_DOCK_BROWSER).toBe('chrome')
  })

  it('parses a deprecated value through the schema exactly like the new name', () => {
    const viaDeprecated = EnvSchema.parse(
      applyDeprecatedVoiceEnvAliases({ VYNEL_VOICE_JARVIS_WINDOW: '0' }),
    )
    const viaCurrent = EnvSchema.parse(applyDeprecatedVoiceEnvAliases({ VYNEL_VOICE_DOCK_WINDOW: '0' }))

    expect(viaDeprecated.VYNEL_VOICE_DOCK_WINDOW).toBe(viaCurrent.VYNEL_VOICE_DOCK_WINDOW)
  })
})
