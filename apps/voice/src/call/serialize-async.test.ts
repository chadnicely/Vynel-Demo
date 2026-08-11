import { describe, expect, it } from 'vitest'
import { serializeAsync } from './serialize-async.js'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('serializeAsync', () => {
  it('runs overlapping calls strictly in order, even when later ones resolve faster', async () => {
    const order: string[] = []
    const releases: Array<() => void> = []
    const gated = serializeAsync(async (name: string) => {
      order.push(`start:${name}`)
      await new Promise<void>((resolve) => releases.push(resolve))
      order.push(`end:${name}`)
      return name
    })

    const first = gated('a')
    const second = gated('b')
    await tick()
    // b must not have started while a holds the queue.
    expect(order).toEqual(['start:a'])

    releases[0]?.()
    await tick()
    expect(order).toEqual(['start:a', 'end:a', 'start:b'])
    releases[1]?.()
    expect(await first).toBe('a')
    expect(await second).toBe('b')
  })

  it('a rejection fails its caller without wedging the queue', async () => {
    let calls = 0
    const gated = serializeAsync(async (shouldFail: boolean) => {
      calls += 1
      if (shouldFail) throw new Error('boom')
      return calls
    })

    await expect(gated(true)).rejects.toThrow('boom')
    expect(await gated(false)).toBe(2)
  })
})
