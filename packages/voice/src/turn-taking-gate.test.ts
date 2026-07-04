import { describe, it, expect } from 'vitest'
import { TurnTakingGate } from './turn-taking-gate.js'

describe('TurnTakingGate', () => {
  it('starts open by default — waitUntilOpen resolves immediately', async () => {
    const gate = new TurnTakingGate()
    expect(gate.isOpen).toBe(true)
    await gate.waitUntilOpen() // must not hang
  })

  it('blocks while closed during a turn, then resolves on open', async () => {
    const gate = new TurnTakingGate()
    gate.close()
    let resolved = false
    const waiting = gate.waitUntilOpen().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false) // mic stays closed while the assistant speaks
    gate.open()
    await waiting
    expect(resolved).toBe(true)
  })

  it('is sticky: open() before waitUntilOpen() never deadlocks', async () => {
    const gate = new TurnTakingGate()
    gate.close()
    gate.open() // released before anyone waits
    await gate.waitUntilOpen() // must resolve immediately, not hang
    expect(gate.isOpen).toBe(true)
  })

  it('releases multiple concurrent waiters on a single open', async () => {
    const gate = new TurnTakingGate()
    gate.close()
    let count = 0
    const a = gate.waitUntilOpen().then(() => {
      count += 1
    })
    const b = gate.waitUntilOpen().then(() => {
      count += 1
    })
    gate.open()
    await Promise.all([a, b])
    expect(count).toBe(2)
  })

  it('is reusable across turns (close/open cycles)', async () => {
    const gate = new TurnTakingGate()
    gate.close()
    gate.open()
    await gate.waitUntilOpen()

    gate.close()
    expect(gate.isOpen).toBe(false)
    let resolved = false
    const waiting = gate.waitUntilOpen().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    gate.open()
    await waiting
    expect(resolved).toBe(true)
  })
})
