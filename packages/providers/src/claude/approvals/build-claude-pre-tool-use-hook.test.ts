// Policy unit tests for the PreToolUse safety backstop. These lock the
// WHICH-TOOLS policy (the can't-be-skipped invariant's decision logic).
// The LIVE behavior — that a real bypassPermissions subagent honors this
// hook and routes 'ask' into the card — is proven separately by the live
// safety smoke (the SDK cannot be unit-mocked into proving that).

import { describe, expect, it } from 'vitest'
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk'
import { buildClaudePreToolUseHook } from './build-claude-pre-tool-use-hook.js'
import { TOOLS_ALWAYS_REQUIRING_APPROVAL } from './tools-always-requiring-approval.js'

type HookInput = Parameters<HookCallback>[0]

function makePreToolInput(
  toolName: string,
  hookEventName = 'PreToolUse',
  agentId?: string,
): HookInput {
  return {
    hook_event_name: hookEventName,
    tool_name: toolName,
    tool_input: {},
    tool_use_id: 'tool-1',
    session_id: 'sess-1',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/tmp/ws',
    // Present only for a subagent call (BaseHookInput.agent_id) — the lever the
    // hook uses to keep the floor for subagents even under an auto root.
    ...(agentId !== undefined ? { agent_id: agentId } : {}),
  } as unknown as HookInput
}

const hookOptions = { signal: new AbortController().signal }

describe('buildClaudePreToolUseHook', () => {
  const hook = buildClaudePreToolUseHook('bypass-with-behavior-gate')

  it("returns permissionDecision 'ask' for every irreversible tool (forces the card)", async () => {
    for (const toolName of TOOLS_ALWAYS_REQUIRING_APPROVAL) {
      const result = await hook(makePreToolInput(toolName), undefined, hookOptions)
      const decision = (result as { hookSpecificOutput?: { permissionDecision?: string } })
        .hookSpecificOutput?.permissionDecision
      expect(decision, `tool ${toolName} must force 'ask'`).toBe('ask')
    }
  })

  it('returns no opinion ({}) for a safe, reversible tool', async () => {
    for (const toolName of ['Read', 'Grep', 'Glob', 'WebSearch']) {
      const result = await hook(makePreToolInput(toolName), undefined, hookOptions)
      expect(result).toEqual({})
    }
  })

  it('returns no opinion for a non-PreToolUse hook event', async () => {
    const result = await hook(makePreToolInput('Write', 'PostToolUse'), undefined, hookOptions)
    expect(result).toEqual({})
  })

  it("gives no opinion for a feature tool (act_on_app) when no per-turn set is passed", async () => {
    // Proves the per-turn behavior is NOT hardcoded — without the set, act_on_app
    // (not in the static floor) gets no opinion.
    const result = await hook(makePreToolInput('mcp__desktop__act_on_app'), undefined, hookOptions)
    expect(result).toEqual({})
  })

  function decisionOf(result: Awaited<ReturnType<HookCallback>>): string | undefined {
    return (result as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
      ?.permissionDecision
  }

  describe('with a per-turn alwaysRequireApprovalToolNames set (additive to the floor)', () => {
    const hookWithFeature = buildClaudePreToolUseHook(
      'bypass-with-behavior-gate',
      new Set(['mcp__desktop__act_on_app']),
    )

    it("forces 'ask' for the per-turn feature mutating tool", async () => {
      const result = await hookWithFeature(makePreToolInput('mcp__desktop__act_on_app'), undefined, hookOptions)
      expect(decisionOf(result)).toBe('ask')
    })

    it("still forces 'ask' for the static floor (the set only ADDS)", async () => {
      const result = await hookWithFeature(makePreToolInput('Write'), undefined, hookOptions)
      expect(decisionOf(result)).toBe('ask')
    })

    it('still gives no opinion for a safe tool', async () => {
      const result = await hookWithFeature(makePreToolInput('Read'), undefined, hookOptions)
      expect(result).toEqual({})
    })
  })

  describe('in auto mode — the MAIN session defers to the classifier; subagents keep the floor', () => {
    const autoHook = buildClaudePreToolUseHook('auto', new Set(['mcp__desktop__act_on_app']))

    it('MAIN session (no agent_id): gives no opinion ({}) even for floor + per-turn tools', async () => {
      for (const toolName of [...TOOLS_ALWAYS_REQUIRING_APPROVAL, 'mcp__desktop__act_on_app', 'Read']) {
        const result = await autoHook(makePreToolInput(toolName), undefined, hookOptions)
        expect(result, `auto main must defer ${toolName} to the classifier`).toEqual({})
      }
    })

    it("SUBAGENT (agent_id present): still forces 'ask' on floor + per-turn tools (the SDK does not clamp a subagent's mode under an auto root)", async () => {
      for (const toolName of [...TOOLS_ALWAYS_REQUIRING_APPROVAL, 'mcp__desktop__act_on_app']) {
        const result = await autoHook(
          makePreToolInput(toolName, 'PreToolUse', 'agent-x'),
          undefined,
          hookOptions,
        )
        expect(decisionOf(result), `auto subagent must still card ${toolName}`).toBe('ask')
      }
    })

    it('SUBAGENT (agent_id present): still gives no opinion for a safe tool', async () => {
      const result = await autoHook(
        makePreToolInput('Read', 'PreToolUse', 'agent-x'),
        undefined,
        hookOptions,
      )
      expect(result).toEqual({})
    })
  })
})
