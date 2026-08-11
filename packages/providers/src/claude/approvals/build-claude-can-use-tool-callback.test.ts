// Tests for `buildClaudeCanUseToolCallback` — the SDK permission-hook bridge.
// The callback awaits a Promise resolved from outside; each test drives it by
// reading the emitted `approval-requested` event, then resolving the
// pending-approval registry with a decision.
// See `docs/blueprints/providers/blueprint.md §11.4`.

import { describe, expect, it } from 'vitest'
import { buildClaudeCanUseToolCallback } from './build-claude-can-use-tool-callback.js'
import { SyntheticEventQueue } from '../session/synthetic-event-queue.js'
import { PendingApprovalRegistry } from '../../shared/pending-approval-registry.js'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'

// The SDK's `canUseTool` third argument — `signal` + `toolUseID` + (since SDK
// 0.3.213) `requestId` are required. The callback threads `toolUseID` onto
// both synthetic approval events (the chat consumer's row correlation).
const TOOL_OPTIONS = {
  signal: new AbortController().signal,
  toolUseID: 'tu_test',
  requestId: 'req_test',
}

function setup(
  permissionMode: 'ask' | 'auto' | 'bypass' | 'bypass-with-behavior-gate' | 'plan-only',
  alwaysRequireApprovalToolNames?: ReadonlySet<string>,
) {
  const pendingApprovalRegistry = new PendingApprovalRegistry()
  const syntheticEventQueue = new SyntheticEventQueue<NormalizedSessionEvent>()
  const callback = buildClaudeCanUseToolCallback({
    pendingApprovalRegistry,
    permissionMode,
    sessionIdHolder: { current: 'sess-1' },
    syntheticEventQueue,
    ...(alwaysRequireApprovalToolNames !== undefined ? { alwaysRequireApprovalToolNames } : {}),
  })
  return { pendingApprovalRegistry, syntheticEventQueue, callback }
}

describe('buildClaudeCanUseToolCallback', () => {
  it("user bypass: bypass means bypass — even Bash and a feature mutating tool run without a card (2026-07-30 stance)", async () => {
    const { callback, syntheticEventQueue } = setup(
      'bypass',
      new Set(['mcp__desktop__act_on_app']),
    )
    for (const [toolName, toolInput] of [
      ['Bash', { command: 'ls' }],
      ['Write', { path: 'a.txt' }],
      ['mcp__desktop__act_on_app', { action: 'press' }],
    ] as const) {
      const result = await callback(toolName, toolInput, TOOL_OPTIONS)
      expect(result).toEqual({ behavior: 'allow', updatedInput: toolInput })
    }
    expect(syntheticEventQueue.isEmpty()).toBe(true) // no approval-requested emitted
  })

  it('behavior gate (unattended default): a non-listed tool runs without approval', async () => {
    const { callback, syntheticEventQueue } = setup('bypass-with-behavior-gate')
    const result = await callback('Read', { file: 'a.txt' }, TOOL_OPTIONS)
    expect(result).toEqual({ behavior: 'allow', updatedInput: { file: 'a.txt' } })
    expect(syntheticEventQueue.isEmpty()).toBe(true)
  })

  it('behavior gate (unattended default): a listed tool (Bash) still requires approval', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup(
      'bypass-with-behavior-gate',
    )
    const resultPromise = callback('Bash', { command: 'ls' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    expect(requested.toolName).toBe('Bash')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect(await resultPromise).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
  })

  it('auto gate: NOTHING cards — auto means no approval needed', async () => {
    // test: correct expectation — was "cards whatever reaches it… exactly like
    // ask" (classifier escalations carded in auto, Chad 2026-07-30). Kafi
    // overruled 2026-08-11 after a live smoke: an escalated approval parked a
    // desktop turn on a card the user never expected, in the one mode that
    // promises not to ask. Auto now allows outright, like bypass.
    //
    // Asserted on a FLOOR tool, not just a safe one: if even Bash runs uncarded
    // here, no escalation can park a turn in auto.
    const { callback, syntheticEventQueue } = setup('auto')
    expect(await callback('Bash', { command: 'ls' }, TOOL_OPTIONS)).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls' },
    })
    expect(await callback('Read', { file: 'a.txt' }, TOOL_OPTIONS)).toEqual({
      behavior: 'allow',
      updatedInput: { file: 'a.txt' },
    })
    // No approval was ever enqueued — nothing for a UI to render, nothing to
    // await, so a missing card can no longer hang the turn.
    expect(syntheticEventQueue.isEmpty()).toBe(true)
  })

  it('auto gate: a desktop tool runs uncarded — the exact hang from the live smoke', async () => {
    const { callback } = setup('auto')
    const result = await callback(
      'mcp__desktop__request_desktop_access',
      { app: 'Zoom Workplace', tier: 'full', reason: 'send a message' },
      TOOL_OPTIONS,
    )
    expect(result?.behavior).toBe('allow')
  })

  it('behavior gate: the memory-write tool runs WITHOUT a card under the unattended default (self-tool, 2026-07-26 stance)', async () => {
    // Chad's refined approval stance — "Claude's self-tools (memory,
    // knowledge, tasks) do NOT need approval" — removed create_memory_entry
    // from the floor. Vynel MCP approval lives in the ask-mode destructive
    // tier instead.
    const { callback } = setup('bypass-with-behavior-gate')
    const result = await callback(
      'mcp__vynel__create_memory_entry',
      { kind: 'note', body: 'remember this' },
      TOOL_OPTIONS,
    )
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { kind: 'note', body: 'remember this' },
    })
  })

  it('behavior gate: a per-turn feature mutating tool (act_on_app) still cards under the unattended default', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup(
      'bypass-with-behavior-gate',
      new Set(['mcp__desktop__act_on_app']),
    )
    const resultPromise = callback('mcp__desktop__act_on_app', { action: 'press' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    expect(requested.toolName).toBe('mcp__desktop__act_on_app')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect((await resultPromise)?.behavior).toBe('allow')
  })

  it('ask mode: every tool requires approval, even a read-only one', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('ask')
    const resultPromise = callback('Read', { file: 'a.txt' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    expect(requested.kind).toBe('approval-requested')
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect((await resultPromise)?.behavior).toBe('allow')
  })

  it('approved with updatedInput substitutes the edited input', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('ask')
    const resultPromise = callback('Write', { path: 'a.txt', content: 'old' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    pendingApprovalRegistry.resolve(requested.approvalRequestId, {
      kind: 'approved',
      updatedInput: { path: 'a.txt', content: 'edited' },
    })
    expect(await resultPromise).toEqual({
      behavior: 'allow',
      updatedInput: { path: 'a.txt', content: 'edited' },
    })
  })

  it('denied returns behavior deny with the reason as the message', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('ask')
    const resultPromise = callback('Bash', { command: 'rm -rf /' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    pendingApprovalRegistry.resolve(requested.approvalRequestId, {
      kind: 'denied',
      reason: 'too destructive',
    })
    expect(await resultPromise).toEqual({ behavior: 'deny', message: 'too destructive' })
  })

  it('timed-out and cancelled both deny the tool use', async () => {
    for (const decision of [{ kind: 'timed-out' }, { kind: 'cancelled' }] as const) {
      const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('ask')
      const resultPromise = callback('Bash', { command: 'ls' }, TOOL_OPTIONS)
      const requested = await syntheticEventQueue.dequeue()
      if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
      pendingApprovalRegistry.resolve(requested.approvalRequestId, decision)
      expect((await resultPromise)?.behavior).toBe('deny')
    }
  })

  it('emits approval-resolved carrying the decision after the user decides', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('ask')
    const resultPromise = callback('Bash', { command: 'ls' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    await resultPromise

    const resolved = await syntheticEventQueue.dequeue()
    if (resolved.kind !== 'approval-resolved') throw new Error('expected approval-resolved')
    expect(resolved.approvalRequestId).toBe(requested.approvalRequestId)
    expect(resolved.decision).toEqual({ kind: 'approved' })
  })

  it('threads the SDK toolUseID onto both approval events (the row correlation)', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('ask')
    const resultPromise = callback('Bash', { command: 'ls' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    expect(requested.toolUseId).toBe('tu_test')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, {
      kind: 'denied',
      reason: 'not now',
    })
    await resultPromise

    const resolved = await syntheticEventQueue.dequeue()
    if (resolved.kind !== 'approval-resolved') throw new Error('expected approval-resolved')
    expect(resolved.toolUseId).toBe('tu_test')
  })
})
