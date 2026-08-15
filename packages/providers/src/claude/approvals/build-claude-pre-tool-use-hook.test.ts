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
  const askHook = buildClaudePreToolUseHook('ask')

  it("ask mode: returns permissionDecision 'ask' for every irreversible tool (forces the card)", async () => {
    for (const toolName of TOOLS_ALWAYS_REQUIRING_APPROVAL) {
      const result = await askHook(makePreToolInput(toolName), undefined, hookOptions)
      const decision = (result as { hookSpecificOutput?: { permissionDecision?: string } })
        .hookSpecificOutput?.permissionDecision
      expect(decision, `tool ${toolName} must force 'ask'`).toBe('ask')
    }
  })

  it('ask mode: returns no opinion ({}) for a safe, reversible tool', async () => {
    for (const toolName of ['Read', 'Grep', 'Glob', 'WebSearch']) {
      const result = await askHook(makePreToolInput(toolName), undefined, hookOptions)
      expect(result).toEqual({})
    }
  })

  it('returns no opinion for a non-PreToolUse hook event', async () => {
    const result = await askHook(makePreToolInput('Write', 'PostToolUse'), undefined, hookOptions)
    expect(result).toEqual({})
  })

  it('ask mode: gives no opinion for a feature tool (act_on_app) when no per-turn set is passed', async () => {
    // Proves the per-turn behavior is NOT hardcoded — without the set, act_on_app
    // (not in the static floor) gets no opinion.
    const result = await askHook(
      makePreToolInput('mcp__desktop__act_on_app'),
      undefined,
      hookOptions,
    )
    expect(result).toEqual({})
  })

  function decisionOf(result: Awaited<ReturnType<HookCallback>>): string | undefined {
    return (result as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
      ?.permissionDecision
  }

  describe('with a per-turn alwaysRequireApprovalToolNames set (additive to the floor, ask mode)', () => {
    const hookWithFeature = buildClaudePreToolUseHook('ask', new Set(['mcp__desktop__act_on_app']))

    it("forces 'ask' for the per-turn feature mutating tool", async () => {
      const result = await hookWithFeature(
        makePreToolInput('mcp__desktop__act_on_app'),
        undefined,
        hookOptions,
      )
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

  describe("the user's bypass never cards (2026-07-30 stance: bypass means bypass)", () => {
    const bypassHook = buildClaudePreToolUseHook('bypass', new Set(['mcp__desktop__act_on_app']))

    it('gives no opinion for floor + per-turn tools, main session', async () => {
      for (const toolName of [...TOOLS_ALWAYS_REQUIRING_APPROVAL, 'mcp__desktop__act_on_app']) {
        const result = await bypassHook(makePreToolInput(toolName), undefined, hookOptions)
        expect(result, `bypass must not card ${toolName}`).toEqual({})
      }
    })

    it('gives no opinion for a SUBAGENT call too (the mode is the trust level for the whole turn)', async () => {
      const result = await bypassHook(
        makePreToolInput('Write', 'PreToolUse', 'agent-x'),
        undefined,
        hookOptions,
      )
      expect(result).toEqual({})
    })
  })

  describe('the UNATTENDED default (bypass-with-behavior-gate) keeps the floor', () => {
    const unattendedHook = buildClaudePreToolUseHook(
      'bypass-with-behavior-gate',
      new Set(['mcp__desktop__act_on_app']),
    )

    it("forces 'ask' for floor + per-turn tools — a background turn carries no user trust pick", async () => {
      for (const toolName of [...TOOLS_ALWAYS_REQUIRING_APPROVAL, 'mcp__desktop__act_on_app']) {
        const result = await unattendedHook(makePreToolInput(toolName), undefined, hookOptions)
        expect(decisionOf(result), `unattended default must card ${toolName}`).toBe('ask')
      }
    })

    it('still gives no opinion for a safe tool', async () => {
      const result = await unattendedHook(makePreToolInput('Read'), undefined, hookOptions)
      expect(result).toEqual({})
    })
  })

  describe('the ask-mode destructive tier (askModeApprovalToolNames)', () => {
    // The tier cards only under ask/plan-only. The hook's 'ask' decision is
    // the SUBAGENT rescue (a skip-mode subagent bypasses canUseTool; live
    // smoke 2026-06-21); the main session reaches the callback's policy map
    // directly. Auto/bypass run the same tools uncarded — Chad's stance.
    const askSet = new Set(['mcp__vynel__remove_knowledge_source'])

    it("ask mode: forces 'ask' for a destructive-tier tool (main AND subagent)", async () => {
      const askHook = buildClaudePreToolUseHook('ask', undefined, askSet)
      const main = await askHook(
        makePreToolInput('mcp__vynel__remove_knowledge_source'),
        undefined,
        hookOptions,
      )
      expect(decisionOf(main)).toBe('ask')
      const sub = await askHook(
        makePreToolInput('mcp__vynel__remove_knowledge_source', 'PreToolUse', 'agent-x'),
        undefined,
        hookOptions,
      )
      expect(decisionOf(sub)).toBe('ask')
    })

    it('ask mode: still gives no opinion for a non-tier MCP tool (self-tools stay uncarded)', async () => {
      const askHook = buildClaudePreToolUseHook('ask', undefined, askSet)
      const result = await askHook(
        makePreToolInput('mcp__vynel__create_memory_entry'),
        undefined,
        hookOptions,
      )
      expect(result).toEqual({})
    })

    it("plan-only mode: forces 'ask' for a destructive-tier tool (defensive — nothing routes plan-only today)", async () => {
      const planHook = buildClaudePreToolUseHook('plan-only', undefined, askSet)
      const result = await planHook(
        makePreToolInput('mcp__vynel__remove_knowledge_source'),
        undefined,
        hookOptions,
      )
      expect(decisionOf(result)).toBe('ask')
    })

    it('bypass mode: the tier does NOT card (no approval outside ask)', async () => {
      const bypassHook = buildClaudePreToolUseHook('bypass-with-behavior-gate', undefined, askSet)
      const result = await bypassHook(
        makePreToolInput('mcp__vynel__remove_knowledge_source'),
        undefined,
        hookOptions,
      )
      expect(result).toEqual({})
    })

    it('auto mode: the tier does NOT card — main or subagent (the floor backstop is separate)', async () => {
      const autoHook = buildClaudePreToolUseHook('auto', undefined, askSet)
      const main = await autoHook(
        makePreToolInput('mcp__vynel__remove_knowledge_source'),
        undefined,
        hookOptions,
      )
      expect(main).toEqual({})
      const sub = await autoHook(
        makePreToolInput('mcp__vynel__remove_knowledge_source', 'PreToolUse', 'agent-x'),
        undefined,
        hookOptions,
      )
      expect(sub).toEqual({})
    })
  })

  describe('in auto mode — the classifier is the sole gate, main session AND subagents', () => {
    const autoHook = buildClaudePreToolUseHook('auto', new Set(['mcp__desktop__act_on_app']))

    it('MAIN session (no agent_id): gives no opinion ({}) even for floor + per-turn tools', async () => {
      for (const toolName of [...TOOLS_ALWAYS_REQUIRING_APPROVAL, 'mcp__desktop__act_on_app', 'Read']) {
        const result = await autoHook(makePreToolInput(toolName), undefined, hookOptions)
        expect(result, `auto main must defer ${toolName} to the classifier`).toEqual({})
      }
    })

    it('SUBAGENT (agent_id present): gives no opinion too (2026-07-30 stance — the session mode covers the whole turn)', async () => {
      for (const toolName of [...TOOLS_ALWAYS_REQUIRING_APPROVAL, 'mcp__desktop__act_on_app', 'Read']) {
        const result = await autoHook(
          makePreToolInput(toolName, 'PreToolUse', 'agent-x'),
          undefined,
          hookOptions,
        )
        expect(result, `auto subagent must not card ${toolName}`).toEqual({})
      }
    })
  })
})

describe('forced-synchronous subagents (the Agent/Task run_in_background rewrite)', () => {
  const hook = buildClaudePreToolUseHook('bypass-with-behavior-gate')

  function makeAgentInput(toolInput: Record<string, unknown>, toolName = 'Agent'): HookInput {
    return {
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: 'tool-agent-1',
      session_id: 'sess-1',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp/ws',
    } as unknown as HookInput
  }

  it('rewrites an Agent spawn to run_in_background: false (background default would outlive the turn)', async () => {
    const result = await hook(
      makeAgentInput({ description: 'sweep', prompt: 'go' }),
      undefined,
      hookOptions,
    )
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { description: 'sweep', prompt: 'go', run_in_background: false },
      },
    })
  })

  it('rewrites an explicit run_in_background: true (and the classic Task tool too)', async () => {
    const result = await hook(
      makeAgentInput({ prompt: 'go', run_in_background: true }, 'Task'),
      undefined,
      hookOptions,
    )
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { prompt: 'go', run_in_background: false },
      },
    })
  })

  it('leaves an already-synchronous spawn untouched (no needless rewrite)', async () => {
    const result = await hook(
      makeAgentInput({ prompt: 'go', run_in_background: false }),
      undefined,
      hookOptions,
    )
    expect(result).toEqual({})
  })

  it('forces sync even for the auto MAIN session (the stand-down is approval policy, not spawn policy)', async () => {
    const autoHook = buildClaudePreToolUseHook('auto')
    const result = await autoHook(
      makeAgentInput({ prompt: 'go' }),
      undefined,
      hookOptions,
    )
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { prompt: 'go', run_in_background: false },
      },
    })
  })
})
