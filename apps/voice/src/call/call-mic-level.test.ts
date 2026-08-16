import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { restoreCallMicLevels, type EncodedPowerShellRunner } from './call-mic-level.js'

const silentLogger = () => pino({ level: 'silent' })

const runnerOf = (stdout: string): EncodedPowerShellRunner => async (encodedCommand) => {
  // The command must be intact base64 (the -EncodedCommand contract).
  expect(() => Buffer.from(encodedCommand, 'base64')).not.toThrow()
  return { stdout }
}

describe('restoreCallMicLevels', () => {
  it('parses one report per JSON line', async () => {
    const stdout = [
      '{"name":"Vynel Call 1 Microphone (Vynel Audio)","beforePercent":8,"afterPercent":100,"wasMuted":false}',
      '{"name":"Vynel Call 2 Microphone (Vynel Audio)","beforePercent":100,"afterPercent":100,"wasMuted":false}',
    ].join('\r\n')

    const reports = await restoreCallMicLevels(silentLogger(), runnerOf(stdout))

    expect(reports).toHaveLength(2)
    expect(reports[0]).toEqual({
      name: 'Vynel Call 1 Microphone (Vynel Audio)',
      beforePercent: 8,
      afterPercent: 100,
      wasMuted: false,
    })
  })

  it('skips console noise and malformed lines, keeping the valid reports', async () => {
    const stdout = [
      'WARNING: something unrelated',
      '{ not json',
      '{"unrelated":"shape"}',
      '{"name":"Vynel Call 1 Microphone (Vynel Audio)","beforePercent":50,"afterPercent":100,"wasMuted":true}',
    ].join('\n')

    const reports = await restoreCallMicLevels(silentLogger(), runnerOf(stdout))

    expect(reports).toHaveLength(1)
    expect(reports[0]?.wasMuted).toBe(true)
  })

  it('a failed shell-out is swallowed into an empty report — never a thrown call start', async () => {
    const reports = await restoreCallMicLevels(silentLogger(), async () => {
      throw new Error('powershell.exe not found')
    })

    expect(reports).toEqual([])
  })
})
