import { describe, it, expect } from 'vitest'
import { ForbiddenError } from '@vynel/errors'
import { createDesktopPlanEnvelope, type DesktopActRecord } from './desktop-plan-envelope.js'
import { recordFailedAct } from './record-failed-act.js'

function envelopeCapturing(written: DesktopActRecord[]) {
  const envelope = createDesktopPlanEnvelope('approval-card', {
    write: (record) => written.push(record),
  })
  envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'full' }] })
  return envelope
}

describe('recordFailedAct', () => {
  it('records an act that was attempted and THREW', () => {
    // The whole point: a batch that dies at step 3 used to log the two steps
    // that worked and nothing about the one that didn't — reading as "no
    // problem" for exactly the question the record exists to answer.
    const written: DesktopActRecord[] = []
    recordFailedAct(
      envelopeCapturing(written),
      { tool: 'act_on_app', appName: 'Notepad', detail: 'type_text threw' },
      new Error('element vanished'),
    )
    expect(written).toEqual([
      expect.objectContaining({
        tool: 'act_on_app',
        outcome: 'failed',
        detail: 'type_text threw',
        note: 'element vanished',
      }),
    ])
  })

  it('records NOTHING for a refusal — nothing happened', () => {
    // The plan gate throws BEFORE anything touches the desktop. Logging those
    // would fill the user's record with things Claude never did.
    const written: DesktopActRecord[] = []
    recordFailedAct(
      envelopeCapturing(written),
      { tool: 'act_on_app', detail: 'x' },
      new ForbiddenError('Desktop access denied'),
    )
    expect(written).toEqual([])
  })

  it('survives a non-Error throw without losing the row', () => {
    const written: DesktopActRecord[] = []
    recordFailedAct(envelopeCapturing(written), { tool: 'launch_app', detail: 'x' }, 'boom')
    expect(written[0]).toMatchObject({ outcome: 'failed', note: 'boom' })
  })

  it('never throws, even when the writer does', () => {
    // Called from a catch block: throwing here would replace the real error.
    const envelope = createDesktopPlanEnvelope('approval-card', {
      write: () => {
        throw new Error('db gone')
      },
    })
    expect(() =>
      recordFailedAct(envelope, { tool: 'x', detail: 'y' }, new Error('original')),
    ).not.toThrow()
  })
})
