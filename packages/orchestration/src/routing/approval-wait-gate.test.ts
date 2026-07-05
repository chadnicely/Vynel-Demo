// Unit tests for `ApprovalWaitGate` — the parked-approval signal between the
// routed approval handler and routeRequest's pausable wait clock.

import { describe, expect, it } from 'vitest'
import { ApprovalWaitGate } from './approval-wait-gate.js'

describe('ApprovalWaitGate', () => {
  it('fires the listener on each edge — parked on the first park, resumed on the last resolve', () => {
    const gate = new ApprovalWaitGate()
    const edges: boolean[] = []
    gate.onParkedChange((parked) => edges.push(parked))

    gate.markParked() // 0 → 1: parked edge
    gate.markParked() // 1 → 2: no edge
    gate.markResolved() // 2 → 1: no edge
    gate.markResolved() // 1 → 0: resumed edge

    expect(edges).toEqual([true, false])
    expect(gate.isParked).toBe(false)
  })

  it('ignores a resolve with nothing parked (an auto-approved card never parked)', () => {
    const gate = new ApprovalWaitGate()
    const edges: boolean[] = []
    gate.onParkedChange((parked) => edges.push(parked))

    gate.markResolved()
    expect(edges).toEqual([])

    gate.markParked()
    expect(gate.isParked).toBe(true)
    expect(edges).toEqual([true])
  })
})
