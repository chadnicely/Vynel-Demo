// The `checkpoint` tool's response contract: it records the pending
// checkpoint on the turn's OWN identity (the compose-time primary id — never
// model input) and tells the model to end the turn; a plain conversation (no
// continuing identity) is told plainly it cannot checkpoint.

import { afterEach, describe, expect, it } from 'vitest'
import { clearPendingCheckpoint, peekPendingCheckpoint } from '../continuity/pending-checkpoints.js'
import { buildCheckpointResponse } from './checkpoint-tool.js'

const PRIMARY = 'primary-checkpoint-tool-test'

afterEach(() => {
  clearPendingCheckpoint(PRIMARY)
})

describe('checkpoint tool', () => {
  it('marks the pending checkpoint on the turn identity and asks the model to end the turn', () => {
    const response = buildCheckpointResponse(
      { primarySessionId: PRIMARY },
      { nextStep: '  wire the DM stream, then run the gate  ' },
    )
    expect(response.isError).toBeUndefined()
    expect(response.content[0]!.text).toContain('Checkpoint noted: "wire the DM stream, then run the gate"')
    expect(response.content[0]!.text).toContain('END this turn')
    // Recorded under exactly this identity, trimmed.
    expect(peekPendingCheckpoint(PRIMARY)?.nextStep).toBe('wire the DM stream, then run the gate')
  })

  it('a plain conversation (no continuing identity) cannot checkpoint — says so, records nothing', () => {
    const response = buildCheckpointResponse({}, { nextStep: 'anything' })
    expect(response.isError).toBe(true)
    expect(response.content[0]!.text).toContain('no continuing identity')
    expect(peekPendingCheckpoint(PRIMARY)).toBeNull()
  })

  it('an empty next step is an error, not a checkpoint', () => {
    const response = buildCheckpointResponse({ primarySessionId: PRIMARY }, { nextStep: '   ' })
    expect(response.isError).toBe(true)
    expect(peekPendingCheckpoint(PRIMARY)).toBeNull()
  })

  it('caps a runaway next step at the documented length', () => {
    buildCheckpointResponse({ primarySessionId: PRIMARY }, { nextStep: 'x'.repeat(2_000) })
    expect(peekPendingCheckpoint(PRIMARY)?.nextStep).toHaveLength(600)
  })
})
