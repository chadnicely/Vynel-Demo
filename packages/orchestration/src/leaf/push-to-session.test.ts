// S2 fold-in (build brief Slice 3b+4 §2.7): locks the SHIPPED 3a `pushToSession`
// contract with a fake provider BEFORE routing wires it live. No DB — `pushToSession`
// only resumes a leaf by reference and drains the result.
//
// Asserts the safety backstop holds on RESUME too: the follow-up turn re-enters the
// leaf under `permissionMode: 'bypass-with-behavior-gate'`, and the leaf is resumed
// by its reference (the SDK session id), not started fresh.

import { describe, expect, it } from 'vitest'
import type { StartChatSessionInput } from '@vynel/providers'
import { pushToSession } from './push-to-session.js'
import { makeFakeLeafProvider, type CapturedApprovalResponse } from '../test-support/fake-leaf-provider.js'

describe('pushToSession', () => {
  it('resumes the leaf by reference under the behavior-gate and returns the clean result', async () => {
    const captured: StartChatSessionInput[] = []
    const provider = makeFakeLeafProvider(
      { sessionId: 'leaf-sdk-1', resultText: 'Follow-up done.' },
      captured,
    )

    const result = await pushToSession(provider, {
      reference: 'leaf-sdk-1',
      workspacePath: '/ws/a',
      promptText: 'Refine it.',
    })

    expect(result).toBe('Follow-up done.')
    expect(captured).toHaveLength(1)
    // Resume = push: the existing leaf session is re-entered by its reference.
    expect(captured[0]!.resumeSessionId).toBe('leaf-sdk-1')
    expect(captured[0]!.permissionMode).toBe('bypass-with-behavior-gate')
    expect(captured[0]!.userMessageText).toBe('Refine it.')
  })

  it('fail-closed denies a carded tool on the resume path and still returns a result', async () => {
    const approvalResponses: CapturedApprovalResponse[] = []
    const provider = makeFakeLeafProvider(
      { sessionId: 'leaf-sdk-1', resultText: 'Follow-up as text.', approvalToolName: 'Write' },
      undefined,
      approvalResponses,
    )

    const result = await pushToSession(provider, {
      reference: 'leaf-sdk-1',
      workspacePath: '/ws/a',
      promptText: 'Refine it.',
    })

    expect(result).toBe('Follow-up as text.')
    expect(approvalResponses).toHaveLength(1)
    expect(approvalResponses[0]!.decision).toMatchObject({ kind: 'denied' })
  })
})
