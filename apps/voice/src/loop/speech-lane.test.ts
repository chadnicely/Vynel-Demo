import { describe, expect, it } from 'vitest'
import { SpeechLane } from './speech-lane.js'

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('SpeechLane', () => {
  it('runs reservations one after another, in order', async () => {
    const lane = new SpeechLane()
    const first = deferred()
    const order: string[] = []

    const a = lane.reserve(async () => {
      order.push('a:start')
      await first.promise
      order.push('a:end')
      return 'a'
    })
    const b = lane.reserve(async () => {
      order.push('b:start')
      return 'b'
    })
    await Promise.resolve()
    expect(order).toEqual(['a:start']) // b waits for a

    first.resolve()
    expect(await a).toBe('a')
    expect(await b).toBe('b')
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
  })

  it('a rejected reservation never blocks the next one', async () => {
    const lane = new SpeechLane()
    const failed = lane.reserve(async () => {
      throw new Error('synth broke')
    })
    const next = lane.reserve(async () => 'spoken')

    await expect(failed).rejects.toThrow('synth broke')
    expect(await next).toBe('spoken')
  })
})
