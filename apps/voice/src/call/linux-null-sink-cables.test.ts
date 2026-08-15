import { describe, expect, it } from 'vitest'
import pino from 'pino'
import type { PactlRunner } from './linux-null-sink-cables.js'
import { createLinuxCallCablePool, reapStaleVynelModules } from './linux-null-sink-cables.js'

const logger = pino({ level: 'silent' })

interface RecordedCall {
  args: readonly string[]
}

// A scriptable pactl: records every invocation, answers load-module with
// incrementing ids, and lets a test inject failures per invocation index.
function fakePactl(behavior?: {
  failOnCall?: readonly number[]
  stdoutOnCall?: Record<number, string>
  listStdout?: string
}) {
  const calls: RecordedCall[] = []
  let nextModuleId = 101
  const runner: PactlRunner = (args) => {
    const callIndex = calls.length
    calls.push({ args })
    if (behavior?.failOnCall?.includes(callIndex)) {
      return Promise.reject(new Error(`pactl failed on call ${callIndex}`))
    }
    const scripted = behavior?.stdoutOnCall?.[callIndex]
    if (scripted !== undefined) return Promise.resolve({ stdout: scripted })
    if (args[0] === 'list') return Promise.resolve({ stdout: behavior?.listStdout ?? '' })
    if (args[0] === 'load-module') return Promise.resolve({ stdout: `${nextModuleId++}\n` })
    return Promise.resolve({ stdout: '' })
  }
  return { runner, calls }
}

function loadedModuleArgs(calls: readonly RecordedCall[]): string[][] {
  return calls.filter((call) => call.args[0] === 'load-module').map((call) => [...call.args])
}

function unloadedIds(calls: readonly RecordedCall[]): string[] {
  return calls.filter((call) => call.args[0] === 'unload-module').map((call) => call.args[1]!)
}

describe('createLinuxCallCablePool', () => {
  it('creates four modules per pair and names the vynel-facing ends Ears/Voice', async () => {
    const { runner, calls } = fakePactl()

    const pool = await createLinuxCallCablePool(logger, 2, runner)

    expect(pool.pairs).toEqual([
      { inputName: 'Vynel Call 1 Ears', outputName: 'Vynel Call 1 Voice' },
      { inputName: 'Vynel Call 2 Ears', outputName: 'Vynel Call 2 Voice' },
    ])
    const loads = loadedModuleArgs(calls)
    expect(loads).toHaveLength(8)
    expect(loads[0]).toEqual([
      'load-module',
      'module-null-sink',
      'sink_name=vynel_call_1_voice',
      'sink_properties=device.description="Vynel Call 1 Voice"',
    ])
    expect(loads[1]).toEqual([
      'load-module',
      'module-remap-source',
      'master=vynel_call_1_voice.monitor',
      'source_name=vynel_call_1_microphone',
      'source_properties=device.description="Vynel Call 1 Microphone"',
    ])
    expect(loads[2]).toEqual([
      'load-module',
      'module-null-sink',
      'sink_name=vynel_call_1_speaker',
      'sink_properties=device.description="Vynel Call 1 Speaker"',
    ])
    expect(loads[3]).toEqual([
      'load-module',
      'module-remap-source',
      'master=vynel_call_1_speaker.monitor',
      'source_name=vynel_call_1_ears',
      'source_properties=device.description="Vynel Call 1 Ears"',
    ])
    expect(loads[4]?.[2]).toBe('sink_name=vynel_call_2_voice')
  })

  it('creates nothing for a zero pair count', async () => {
    const { runner, calls } = fakePactl()
    const pool = await createLinuxCallCablePool(logger, 0, runner)
    expect(pool.pairs).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('a pactl that is not installed yields an empty pool, never a crash', async () => {
    const { runner } = fakePactl({ failOnCall: [0] })
    const pool = await createLinuxCallCablePool(logger, 2, runner)
    expect(pool.pairs).toEqual([])
  })

  it('rolls back a half-created pair and keeps the pairs that completed', async () => {
    // Pair 1 = calls 0-3. Pair 2 fails on its third module (call index 6):
    // the two already-loaded pair-2 modules (105, 106) roll back in reverse.
    const { runner, calls } = fakePactl({ failOnCall: [6] })

    const pool = await createLinuxCallCablePool(logger, 2, runner)

    expect(pool.pairs).toEqual([{ inputName: 'Vynel Call 1 Ears', outputName: 'Vynel Call 1 Voice' }])
    expect(unloadedIds(calls)).toEqual(['106', '105'])
  })

  it('treats a non-numeric load-module answer as a failed pair', async () => {
    const { runner, calls } = fakePactl({ stdoutOnCall: { 2: 'Failure: Module initialization failed\n' } })

    const pool = await createLinuxCallCablePool(logger, 1, runner)

    expect(pool.pairs).toEqual([])
    expect(unloadedIds(calls)).toEqual(['102', '101'])
  })

  it('destroy unloads everything in reverse and is idempotent', async () => {
    const { runner, calls } = fakePactl()
    const pool = await createLinuxCallCablePool(logger, 2, runner)

    await pool.destroy()
    await pool.destroy()

    expect(unloadedIds(calls)).toEqual(['108', '107', '106', '105', '104', '103', '102', '101'])
  })

  it('destroy keeps going when one unload fails', async () => {
    const { runner, calls } = fakePactl({ failOnCall: [4] }) // first unload (of 104) fails
    const pool = await createLinuxCallCablePool(logger, 1, runner)

    await pool.destroy()

    expect(unloadedIds(calls)).toEqual(['104', '103', '102', '101'])
  })
})

describe('reapStaleVynelModules', () => {
  it('unloads only vynel-named sink and remap modules', async () => {
    const { runner, calls } = fakePactl({
      listStdout: [
        '5\tmodule-null-sink\tsink_name=vynel_call_1_voice sink_properties=...',
        '6\tmodule-remap-source\tmaster=vynel_call_1_voice.monitor source_name=vynel_call_1_microphone',
        '7\tmodule-null-sink\tsink_name=some_other_app_sink',
        '8\tmodule-native-protocol-tcp\t',
        'not a parsable line',
        '',
      ].join('\n'),
    })

    await reapStaleVynelModules(logger, runner)

    // Reverse of listing order — dependents (remaps) before their master sinks.
    expect(unloadedIds(calls)).toEqual(['6', '5'])
  })

  it('a failing module list is a warning, not a crash', async () => {
    const { runner, calls } = fakePactl({ failOnCall: [0] })
    await expect(reapStaleVynelModules(logger, runner)).resolves.toBeUndefined()
    expect(unloadedIds(calls)).toEqual([])
  })

  it('reaps nothing when no vynel modules linger', async () => {
    const { runner, calls } = fakePactl({ listStdout: '8\tmodule-native-protocol-tcp\t\n' })
    await reapStaleVynelModules(logger, runner)
    expect(calls).toHaveLength(1)
  })
})
