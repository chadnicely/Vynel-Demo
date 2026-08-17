// Unit tests for `buildClaudePostToolUseHook` — the mid-turn context channel.
// Drives the hook with synthetic `PostToolUseHookInput`s and asserts the
// contract: the callback sees the LIVE occupancy the runner keeps, a non-null
// line becomes the SDK's `additionalContext`, null says nothing, subagent
// calls and other events are skipped, and a callback failure never throws.

import { describe, expect, it, vi } from 'vitest'
import {
  buildClaudePostToolUseHook,
  type LiveContextHolder,
  type LiveContextState,
} from './build-claude-post-tool-use-hook.js'

const hookContext = { signal: new AbortController().signal }

function postToolUseInput(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: 'sdk-1',
    transcript_path: '',
    cwd: '/tmp/ws',
    tool_name: 'Read',
    tool_input: {},
    tool_response: 'ok',
    tool_use_id: 'tu-1',
    ...overrides,
  } as never
}

describe('buildClaudePostToolUseHook', () => {
  it('delivers the callback line as additionalContext, computed from the LIVE occupancy', async () => {
    const seen: LiveContextState[] = []
    const liveContext: LiveContextHolder = { current: { usedTokens: 900_000, model: 'claude-opus-5' } }
    const hook = buildClaudePostToolUseHook((state) => {
      seen.push(state)
      return `Context check: ${state.usedTokens} tokens used.`
    }, liveContext)

    const result = await hook(postToolUseInput(), undefined, hookContext)

    expect(seen).toEqual([{ usedTokens: 900_000, model: 'claude-opus-5' }])
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'Context check: 900000 tokens used.',
      },
    })
    // The holder is read at CALL time — a later usage report changes what the
    // next tool result hears.
    liveContext.current = { usedTokens: 950_000, model: 'claude-opus-5' }
    await hook(postToolUseInput(), undefined, hookContext)
    expect(seen.at(-1)?.usedTokens).toBe(950_000)
  })

  it('says nothing when the callback returns null / blank, before any usage, and on non-PostToolUse events', async () => {
    const liveContext: LiveContextHolder = { current: { usedTokens: 1_000, model: 'claude-haiku-4-5' } }
    expect(await buildClaudePostToolUseHook(() => null, liveContext)(postToolUseInput(), undefined, hookContext)).toEqual({})
    expect(await buildClaudePostToolUseHook(() => '   ', liveContext)(postToolUseInput(), undefined, hookContext)).toEqual({})
    const untouched = vi.fn(() => 'x')
    expect(
      await buildClaudePostToolUseHook(untouched, { current: null })(postToolUseInput(), undefined, hookContext),
    ).toEqual({})
    expect(
      await buildClaudePostToolUseHook(untouched, liveContext)(
        postToolUseInput({ hook_event_name: 'PreToolUse' }),
        undefined,
        hookContext,
      ),
    ).toEqual({})
    expect(untouched).not.toHaveBeenCalled()
  })

  it("skips a SUBAGENT's tool results — its own window, not the conversation's", async () => {
    const callback = vi.fn(() => 'nudge')
    const hook = buildClaudePostToolUseHook(callback, { current: { usedTokens: 5, model: null } })
    expect(await hook(postToolUseInput({ agent_id: 'agent-7' }), undefined, hookContext)).toEqual({})
    expect(callback).not.toHaveBeenCalled()
  })

  it('never throws on a callback failure — logs and stays silent', async () => {
    const warnings: string[] = []
    const hook = buildClaudePostToolUseHook(
      () => {
        throw new Error('nudge composer broke')
      },
      { current: { usedTokens: 5, model: null } },
      { logger: { warn: (_obj, message) => warnings.push(message) } },
    )
    expect(await hook(postToolUseInput(), undefined, hookContext)).toEqual({})
    expect(warnings).toEqual(['failed to compose tool-result context'])
  })
})
