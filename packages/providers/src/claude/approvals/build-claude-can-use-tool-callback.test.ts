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

// The SDK's `canUseTool` third argument — only `signal` + `toolUseID` are
// required; the callback under test does not read it.
const TOOL_OPTIONS = { signal: new AbortController().signal, toolUseID: 'tu_test' }

function setup(
  permissionMode: 'ask' | 'auto' | 'bypass-with-behavior-gate' | 'plan-only',
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
  it('behavior gate: a non-listed tool runs without approval under bypass mode', async () => {
    const { callback, syntheticEventQueue } = setup('bypass-with-behavior-gate')
    const result = await callback('Read', { file: 'a.txt' }, TOOL_OPTIONS)
    expect(result).toEqual({ behavior: 'allow', updatedInput: { file: 'a.txt' } })
    expect(syntheticEventQueue.isEmpty()).toBe(true) // no approval-requested emitted
  })

  it('behavior gate: a listed tool (Bash) still requires approval under bypass mode', async () => {
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

  it('auto gate: cards whatever reaches it — auto defers to the classifier, then asks like ask', async () => {
    // In auto, Anthropic's classifier approves safe tools (they never reach this
    // callback) and escalates only its uncertain cases here. Vynel then cards
    // them — exactly like ask. Even a non-floor tool (Read) cards if escalated;
    // auto is deliberately NOT in the bypass silent-allow path.
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('auto')
    const resultPromise = callback('Read', { file: 'a.txt' }, TOOL_OPTIONS)
    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    expect(requested.toolName).toBe('Read')
    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect((await resultPromise).behavior).toBe('allow')
  })

  it('behavior gate: the memory-write tool requires approval under bypass mode (approval default true)', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup(
      'bypass-with-behavior-gate',
    )
    const resultPromise = callback(
      'mcp__vynel__create_memory_entry',
      { kind: 'note', body: 'remember this' },
      TOOL_OPTIONS,
    )

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    expect(requested.toolName).toBe('mcp__vynel__create_memory_entry')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect((await resultPromise).behavior).toBe('allow')
  })

  it('behavior gate: a per-turn feature mutating tool (act_on_app) requires approval under bypass', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup(
      'bypass-with-behavior-gate',
      new Set(['mcp__desktop__act_on_app']),
    )
    const resultPromise = callback('mcp__desktop__act_on_app', { action: 'press' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    expect(requested.toolName).toBe('mcp__desktop__act_on_app')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect((await resultPromise).behavior).toBe('allow')
  })

  it('behavior gate: act_on_app runs silently under bypass when NOT in the per-turn set (additive)', async () => {
    // Proves the carding is driven by the passed set, not hardcoded — without it,
    // a non-floor tool runs silently under bypass.
    const { callback, syntheticEventQueue } = setup('bypass-with-behavior-gate')
    const result = await callback('mcp__desktop__act_on_app', { action: 'press' }, TOOL_OPTIONS)
    expect(result).toEqual({ behavior: 'allow', updatedInput: { action: 'press' } })
    expect(syntheticEventQueue.isEmpty()).toBe(true)
  })

  it('behavior gate: the static floor still cards WITH a per-turn set passed (the set only ADDS)', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup(
      'bypass-with-behavior-gate',
      new Set(['mcp__desktop__act_on_app']),
    )
    const resultPromise = callback('Bash', { command: 'ls' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')
    expect(requested.toolName).toBe('Bash')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect((await resultPromise).behavior).toBe('allow')
  })

  it('ask mode: every tool requires approval, even a read-only one', async () => {
    const { callback, syntheticEventQueue, pendingApprovalRegistry } = setup('ask')
    const resultPromise = callback('Read', { file: 'a.txt' }, TOOL_OPTIONS)

    const requested = await syntheticEventQueue.dequeue()
    expect(requested.kind).toBe('approval-requested')
    if (requested.kind !== 'approval-requested') throw new Error('expected approval-requested')

    pendingApprovalRegistry.resolve(requested.approvalRequestId, { kind: 'approved' })
    expect((await resultPromise).behavior).toBe('allow')
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
      expect((await resultPromise).behavior).toBe('deny')
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
})
