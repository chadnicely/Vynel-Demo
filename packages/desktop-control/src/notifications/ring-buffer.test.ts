import { describe, it, expect } from 'vitest'
import { RingBuffer } from './ring-buffer.js'

type Stamped = { timestamp: string; label: string }
const at = (timestamp: string, label: string): Stamped => ({ timestamp, label })
const makeBuffer = (capacity: number) => new RingBuffer<Stamped>(capacity, (item) => item.timestamp)

describe('RingBuffer', () => {
  it('drops the oldest item once capacity is exceeded', () => {
    const buffer = makeBuffer(2)
    buffer.push(at('2026-06-26T10:00:00.000Z', 'a'))
    buffer.push(at('2026-06-26T10:00:01.000Z', 'b'))
    buffer.push(at('2026-06-26T10:00:02.000Z', 'c'))

    expect(buffer.size).toBe(2)
    expect(buffer.listSince().map((item) => item.label)).toEqual(['b', 'c'])
  })

  it('returns all items, oldest-first, when no since is given', () => {
    const buffer = makeBuffer(10)
    buffer.push(at('2026-06-26T10:00:00.000Z', 'a'))
    buffer.push(at('2026-06-26T10:00:01.000Z', 'b'))

    expect(buffer.listSince().map((item) => item.label)).toEqual(['a', 'b'])
  })

  it('returns only items strictly after since', () => {
    const buffer = makeBuffer(10)
    buffer.push(at('2026-06-26T10:00:00.000Z', 'a'))
    buffer.push(at('2026-06-26T10:00:01.000Z', 'b'))
    buffer.push(at('2026-06-26T10:00:02.000Z', 'c'))

    const after = buffer.listSince('2026-06-26T10:00:01.000Z').map((item) => item.label)
    expect(after).toEqual(['c'])
  })

  it('compares by parsed time, not lexically, across differing precisions', () => {
    const buffer = makeBuffer(10)
    // Lexically, "...01.123Z" < "...01Z" (since '.' < 'Z') — a naive string
    // compare would wrongly exclude this later-in-time item.
    buffer.push(at('2026-06-26T10:00:01.123Z', 'later'))

    expect(buffer.listSince('2026-06-26T10:00:01Z').map((item) => item.label)).toEqual(['later'])
  })

  it('treats an unparseable since as no filter (returns all)', () => {
    const buffer = makeBuffer(10)
    buffer.push(at('2026-06-26T10:00:00.000Z', 'a'))

    expect(buffer.listSince('not-a-timestamp').map((item) => item.label)).toEqual(['a'])
  })

  it('clears all items', () => {
    const buffer = makeBuffer(10)
    buffer.push(at('2026-06-26T10:00:00.000Z', 'a'))
    buffer.clear()

    expect(buffer.size).toBe(0)
    expect(buffer.listSince()).toEqual([])
  })

  it('rejects a non-positive capacity', () => {
    expect(() => makeBuffer(0)).toThrow(/positive integer/)
    expect(() => makeBuffer(-1)).toThrow(/positive integer/)
  })
})
