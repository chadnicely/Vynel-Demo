import { describe, it, expect, vi } from 'vitest'
import { buildVolumeInvocation, parseVolumeState, setSystemVolume } from './volume.js'

describe('buildVolumeInvocation', () => {
  it('runs the vendored helper by -File with the policy bypass, args in env vars only', () => {
    const invocation = buildVolumeInvocation({ level: 40, mute: true })
    expect(invocation.args[invocation.args.indexOf('-File') + 1]).toMatch(/volume\.ps1$/)
    expect(invocation.args).toContain('-ExecutionPolicy')
    expect(invocation.env).toEqual({ VYNEL_VOLUME_LEVEL: '40', VYNEL_VOLUME_MUTE: 'true' })
  })

  it('sets no variable for an omitted arg — the helper leaves that half alone', () => {
    expect(buildVolumeInvocation({ level: 40 }).env).toEqual({ VYNEL_VOLUME_LEVEL: '40' })
    expect(buildVolumeInvocation({ mute: false }).env).toEqual({ VYNEL_VOLUME_MUTE: 'false' })
  })
})

describe('parseVolumeState', () => {
  it('parses the helper\'s one JSON line', () => {
    expect(parseVolumeState('{"level":37,"muted":false}\n')).toEqual({ level: 37, muted: false })
  })

  it('throws on an unexpected shape rather than inventing a state', () => {
    expect(() => parseVolumeState('{"volume":37}')).toThrow('unexpected shape')
  })
})

describe('setSystemVolume', () => {
  it('refuses an out-of-range level and never spawns', async () => {
    const run = vi.fn()
    await expect(setSystemVolume({ level: 140 }, { run })).rejects.toThrow('0 to 100')
    await expect(setSystemVolume({ level: 40.5 }, { run })).rejects.toThrow('whole number')
    expect(run).not.toHaveBeenCalled()
  })

  it('returns the state the helper read BACK, not what was asked', async () => {
    // The device may land on its nearest step — the answer is its own report.
    const run = vi.fn().mockResolvedValue('{"level":39,"muted":false}')
    const state = await setSystemVolume({ level: 40 }, { run })
    expect(state).toEqual({ level: 39, muted: false })
  })
})
