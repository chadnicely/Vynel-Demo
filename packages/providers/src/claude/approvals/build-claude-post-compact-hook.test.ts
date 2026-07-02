// Unit tests for `buildClaudePostCompactHook`. Drives the hook with a
// synthetic `PostCompactHookInput` (the live SDK auto-compaction trigger is
// a separate CEO smoke — see OVERNIGHT-STATUS) and asserts the capture
// contract: forward { sdkSessionId, summary }, ignore other events, never
// throw on a callback failure.

import { describe, expect, it, vi } from 'vitest'
import { buildClaudePostCompactHook, type CompactionCapture } from './build-claude-post-compact-hook.js'

const hookContext = { signal: new AbortController().signal }

function postCompactInput(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PostCompact',
    session_id: 'sdk-1',
    transcript_path: '',
    cwd: '/tmp/ws',
    compact_summary: 'A concise summary of the conversation so far.',
    ...overrides,
  } as never
}

describe('buildClaudePostCompactHook', () => {
  it('forwards the session id + compaction summary to the callback', async () => {
    const captured: CompactionCapture[] = []
    const hook = buildClaudePostCompactHook((capture) => {
      captured.push(capture)
    })

    const result = await hook(postCompactInput(), undefined, hookContext)

    expect(result).toEqual({})
    expect(captured).toEqual([
      { sdkSessionId: 'sdk-1', summary: 'A concise summary of the conversation so far.' },
    ])
  })

  it('ignores non-PostCompact events', async () => {
    const onCompaction = vi.fn()
    const hook = buildClaudePostCompactHook(onCompaction)

    const result = await hook(
      { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Read' } as never,
      undefined,
      hookContext,
    )

    expect(result).toEqual({})
    expect(onCompaction).not.toHaveBeenCalled()
  })

  it('never throws when the callback fails — logs and returns', async () => {
    const warn = vi.fn()
    const hook = buildClaudePostCompactHook(
      () => {
        throw new Error('db down')
      },
      { logger: { warn } },
    )

    await expect(hook(postCompactInput(), undefined, hookContext)).resolves.toEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })
})
