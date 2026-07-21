import { describe, it, expect } from 'vitest'
import { createScreenReaderFlagHolder } from './screen-reader-flag.js'

// The runner only ever receives the SPI command; record whether each call sets
// (uiParam 1) or clears (uiParam 0) the flag.
function recordingRunner(): { calls: Array<'set' | 'clear'>; run: (command: string) => Promise<string> } {
  const calls: Array<'set' | 'clear'> = []
  return {
    calls,
    run: (command) => {
      calls.push(command.includes('0x0047, 1') ? 'set' : 'clear')
      return Promise.resolve('')
    },
  }
}

describe('createScreenReaderFlagHolder', () => {
  it('sets once for concurrent holders and clears only after the last release', async () => {
    const { calls, run } = recordingRunner()
    const holder = createScreenReaderFlagHolder(run)

    const releaseFirst = await holder.acquire()
    const releaseSecond = await holder.acquire()
    expect(calls).toEqual(['set'])

    releaseFirst()
    expect(calls).toEqual(['set'])

    releaseSecond()
    expect(calls).toEqual(['set', 'clear'])
  })

  it('a double release is idempotent (never clears under a live holder)', async () => {
    const { calls, run } = recordingRunner()
    const holder = createScreenReaderFlagHolder(run)

    const releaseFirst = await holder.acquire()
    const releaseSecond = await holder.acquire()
    releaseFirst()
    releaseFirst()
    expect(calls).toEqual(['set'])

    releaseSecond()
    expect(calls).toEqual(['set', 'clear'])
  })

  it('re-sets on the next acquire after a full release cycle', async () => {
    const { calls, run } = recordingRunner()
    const holder = createScreenReaderFlagHolder(run)

    ;(await holder.acquire())()
    await holder.acquire()
    expect(calls).toEqual(['set', 'clear', 'set'])
  })
})
