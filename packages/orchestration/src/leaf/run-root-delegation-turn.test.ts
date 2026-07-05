// Unit tests for `runRootDelegationTurn` (brain-tree Phase 1) — the by-reference
// "run a turn on the WORKSPACE ROOT" op. Sibling of pushToSession, but it allows a
// FRESH start (first delegation) and returns the session id (the segment to record).
// Read-safe: a carded tool fails closed (no user watching the routed turn).

import { describe, expect, it } from 'vitest'
import type { StartChatSessionInput } from '@vynel/providers'
import { makeFakeLeafProvider, type CapturedApprovalResponse } from '../test-support/fake-leaf-provider.js'
import { runRootDelegationTurn } from './run-root-delegation-turn.js'

describe('runRootDelegationTurn', () => {
  it('resumes the workspace root session and returns the drained result + its session id', async () => {
    const captured: StartChatSessionInput[] = []
    const provider = makeFakeLeafProvider(
      { sessionId: 'ws-root-1', resultText: 'Acme has 3 docs.' },
      captured,
    )

    const drained = await runRootDelegationTurn(provider, {
      workspacePath: '/tmp/acme',
      resumeSessionId: 'ws-root-1',
      taskText: 'summarize the docs',
    })

    expect(drained.sessionId).toBe('ws-root-1')
    expect(drained.resultText).toBe('Acme has 3 docs.')
    expect(captured[0]!.resumeSessionId).toBe('ws-root-1')
    expect(captured[0]!.userMessageText).toBe('summarize the docs')
    expect(captured[0]!.workspacePath).toBe('/tmp/acme')
  })

  it('starts a FRESH turn when no resumeSessionId is given (the first delegation)', async () => {
    const captured: StartChatSessionInput[] = []
    const provider = makeFakeLeafProvider({ sessionId: 'ws-root-fresh', resultText: 'ok' }, captured)

    const drained = await runRootDelegationTurn(provider, {
      workspacePath: '/tmp/acme',
      taskText: 'first task',
    })

    expect(drained.sessionId).toBe('ws-root-fresh')
    expect(captured[0]!.resumeSessionId).toBeUndefined()
  })

  it('runs under the bypass default when no mode is threaded, and under the given mode otherwise (surface-up step 1)', async () => {
    const capturedDefault: StartChatSessionInput[] = []
    await runRootDelegationTurn(
      makeFakeLeafProvider({ sessionId: 'ws-root-3', resultText: 'ok' }, capturedDefault),
      { workspacePath: '/tmp/acme', taskText: 'read the docs' },
    )
    expect(capturedDefault[0]!.permissionMode).toBe('bypass-with-behavior-gate')

    const capturedAsk: StartChatSessionInput[] = []
    await runRootDelegationTurn(
      makeFakeLeafProvider({ sessionId: 'ws-root-4', resultText: 'ok' }, capturedAsk),
      { workspacePath: '/tmp/acme', taskText: 'read the docs', permissionMode: 'ask' },
    )
    expect(capturedAsk[0]!.permissionMode).toBe('ask')
  })

  it('record-and-park (surface-up): an injected handler parks the approval; the decision resumes the turn', async () => {
    const provider = makeFakeLeafProvider({
      sessionId: 'ws-root-5',
      resultText: 'wrote the file',
      approvalToolName: 'Write',
    })
    const requested: string[] = []
    const resolvedKinds: string[] = []

    const running = runRootDelegationTurn(provider, {
      workspacePath: '/tmp/acme',
      taskText: 'write it',
      // Record-and-park: observe, do NOT respond — the provider stays parked.
      onApprovalRequested: (event) => {
        requested.push(event.approvalRequestId)
      },
      onApprovalResolved: (event) => {
        resolvedKinds.push(event.decision.kind)
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0)) // let the drain reach the park
    expect(requested).toEqual(['appr-1'])

    // The user decides (resolveApproval → respondToApprovalRequest) — the turn resumes.
    await provider.respondToApprovalRequest('appr-1', { kind: 'approved' })
    const drained = await running

    expect(drained.resultText).toBe('wrote the file')
    expect(resolvedKinds).toEqual(['approved'])
  })

  it('fails closed on a carded tool (read-safe) and still completes — no deadlock', async () => {
    const approvalResponses: CapturedApprovalResponse[] = []
    const provider = makeFakeLeafProvider(
      { sessionId: 'ws-root-2', resultText: 'reported as text', approvalToolName: 'Write' },
      undefined,
      approvalResponses,
    )

    const drained = await runRootDelegationTurn(provider, {
      workspacePath: '/tmp/acme',
      resumeSessionId: 'ws-root-2',
      taskText: 'edit the config',
    })

    expect(drained.resultText).toBe('reported as text')
    expect(approvalResponses[0]!.decision.kind).toBe('denied')
  })
})
