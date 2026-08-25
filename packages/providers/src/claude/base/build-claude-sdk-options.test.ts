// Tests for `buildClaudeSdkOptions` — the Vynel→SDK options mapping.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { describe, expect, it } from 'vitest'
import { buildClaudeSdkOptions, CLAUDE_CODE_BASE_TOOL_NAMES } from './build-claude-sdk-options.js'

const base = {
  workspacePath: '/tmp/ws',
  allowedToolNames: [] as string[],
  deniedToolNames: [] as string[],
}

describe('buildClaudeSdkOptions', () => {
  it('maps the "ask" permission mode to the SDK "default" mode', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.permissionMode).toBe('default')
    expect(options.cwd).toBe('/tmp/ws')
    expect(options.includePartialMessages).toBe(true)
    // Without this a subagent's streamed text never leaves the CLI — the
    // agent-activity trace depends on it.
    expect(options.forwardSubagentText).toBe(true)
  })

  it('maps the user "bypass" to bypassPermissions + the acknowledgement flag', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'bypass' })
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.allowDangerouslySkipPermissions).toBe(true)
  })

  it('maps "bypass-with-behavior-gate" to the SDK "default" mode — canUseTool live, no ack flag', () => {
    // Was bypassPermissions + the backstop rescue. With no MCP wildcards in
    // allowedTools, `default` + the canUseTool policy map produces the same
    // net behavior (floor ∪ mutating card, everything else allows) without
    // the SDK's shadowed-callback warning.
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'bypass-with-behavior-gate' })
    expect(options.permissionMode).toBe('default')
    expect(options.allowDangerouslySkipPermissions).toBeUndefined()
  })

  it('maps "plan-only" to the SDK "plan" mode', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'plan-only' })
    expect(options.permissionMode).toBe('plan')
  })

  it('maps "auto" to the SDK "auto" mode (classifier) — without the bypass acknowledgement flag', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'auto' })
    expect(options.permissionMode).toBe('auto')
    // Only bypassPermissions needs the ack flag; auto must NOT set it.
    expect(options.allowDangerouslySkipPermissions).toBeUndefined()
  })

  it('maps thinkingEffort to the SDK effort option; omitted = adaptive default (absent)', () => {
    const withEffort = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      thinkingEffort: 'medium',
    })
    expect(withEffort.effort).toBe('medium')
    // Auto = the field never reaches the SDK — today's behavior byte-for-byte.
    const withoutEffort = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(withoutEffort.effort).toBeUndefined()
  })

  it('passes resumeSessionId through as the SDK resume option', () => {
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      resumeSessionId: 'sess-9',
    })
    expect(options.resume).toBe('sess-9')
  })

  // test: correct expectation for disallowedTools — was "absent when the deny
  // list is empty"; now every session denies the unanswerable natives, so the
  // option is always present (AskUserQuestion has no Vynel answer channel).
  it('sets allowedTools only when non-empty; disallowedTools always carries the caller denials + the unanswerable natives', () => {
    const empty = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(empty.allowedTools).toBeUndefined()
    expect(empty.disallowedTools).toEqual(['AskUserQuestion'])

    const withTools = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      allowedToolNames: ['Read'],
      deniedToolNames: ['Bash'],
    })
    expect(withTools.allowedTools).toEqual(['Read'])
    expect(withTools.disallowedTools).toEqual(['Bash', 'AskUserQuestion'])
  })

  it('always disallows AskUserQuestion — no Vynel answer channel — without duplicating a caller denial', () => {
    // canUseTool answers the native form via `updatedInput.answers`; our
    // callback returns allow-unchanged (auto) or cards an approval (ask), so
    // the form always resolves EMPTY — the model asks and hears silence. The
    // real question channel stays mcp__vynel-ask__ask_user.
    const alreadyDenied = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'auto',
      deniedToolNames: ['AskUserQuestion', 'mcp__vynel__speak'],
    })
    expect(alreadyDenied.disallowedTools).toEqual(['AskUserQuestion', 'mcp__vynel__speak'])

    // Every mode, not just the unattended ones — interactive asks go through
    // the vynel-ask card flow too.
    for (const permissionMode of ['ask', 'auto', 'bypass', 'bypass-with-behavior-gate', 'plan-only'] as const) {
      const options = buildClaudeSdkOptions({ ...base, permissionMode })
      expect(options.disallowedTools, permissionMode).toContain('AskUserQuestion')
    }
  })

  it('forwards mcpServers verbatim with NO mcp__ entries in allowedTools', () => {
    // REGRESSION PIN for CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: a bare
    // `mcp__<server>__*` entry in allowedTools auto-approves the whole server
    // before `canUseTool`, silently un-gating every MCP tool in ask mode.
    // Registration alone offers the tools; the policy map gates each call.
    const fakeServer = { type: 'mcp', name: 'vynel', instance: {} } as never
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      allowedToolNames: ['Read', 'Grep'],
      mcpServers: { vynel: fakeServer },
    })
    expect(options.mcpServers).toEqual({ vynel: fakeServer })
    expect(options.allowedTools).toEqual(['Read', 'Grep'])
    expect(options.allowedTools?.some((name) => name.startsWith('mcp__'))).toBe(false)
  })

  it('omits mcpServers when not provided (regression — existing chat flows unchanged)', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.mcpServers).toBeUndefined()
  })

  it('leaves allowedTools absent when only MCP servers register (the composed-turn shape)', () => {
    // Every turn entry passes an empty native allowlist, so a composed turn
    // now emits NO allowedTools at all — nothing left to shadow the callback.
    const fakeServer = { type: 'mcp', name: 'vynel', instance: {} } as never
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      mcpServers: { vynel: fakeServer },
    })
    expect(options.allowedTools).toBeUndefined()
  })

  it("sends Vynel's stack as the CUSTOM system prompt — never the claude_code preset", () => {
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      systemPromptAppend: 'You are Claude, working through Vynel.',
    })
    expect(options.systemPrompt).toBe('You are Claude, working through Vynel.')
  })

  it('omits the system prompt when no stack is given (the seeded-swap priming turn)', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.systemPrompt).toBeUndefined()
  })

  it("whitelists Claude Code's base tools — Vynel's features arrive as MCP tools", () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.tools).toEqual([...CLAUDE_CODE_BASE_TOOL_NAMES])
    expect(options.tools).not.toContain('Workflow')
  })

  it("turns the SDK's hidden auto-memory off", () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.settings).toEqual({ autoMemoryEnabled: false })
  })

  it('forwards agents to the SDK options when provided, omits them otherwise', () => {
    const agents = { researcher: { description: 'Researches.', prompt: 'You research.' } }
    const withAgents = buildClaudeSdkOptions({ ...base, permissionMode: 'ask', agents })
    expect(withAgents.agents).toEqual(agents)

    const withoutAgents = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(withoutAgents.agents).toBeUndefined()
  })

  it('always wires the PreToolUse safety backstop; the floor cards except under auto and the user bypass', async () => {
    // The hook stays WIRED in every mode (it also owns the forced-sync Agent
    // rewrite); the floor cards in ask/plan-only and the unattended
    // bypass-with-behavior-gate default, and stands down for the user's
    // bypass (2026-07-30 stance) — auto is covered by the test below.
    for (const permissionMode of ['ask', 'bypass', 'bypass-with-behavior-gate', 'plan-only'] as const) {
      const options = buildClaudeSdkOptions({ ...base, permissionMode })
      const preToolUse = options.hooks?.PreToolUse
      expect(preToolUse, `hooks wired for ${permissionMode}`).toBeDefined()
      const hook = preToolUse?.[0]?.hooks?.[0]
      expect(typeof hook).toBe('function')

      const writeInput = {
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: {},
        tool_use_id: 't',
        session_id: 's',
        transcript_path: '',
        cwd: '/tmp/ws',
      } as never
      const writeResult = await hook!(writeInput, undefined, {
        signal: new AbortController().signal,
      })
      const writeDecision = (
        writeResult as { hookSpecificOutput?: { permissionDecision?: string } }
      ).hookSpecificOutput?.permissionDecision
      if (permissionMode === 'bypass') {
        expect(writeResult, 'the user bypass never cards').toEqual({})
      } else {
        expect(writeDecision, `${permissionMode} cards Write`).toBe('ask')
      }

      const readInput = { ...(writeInput as object), tool_name: 'Read' } as never
      const readResult = await hook!(readInput, undefined, {
        signal: new AbortController().signal,
      })
      expect(readResult).toEqual({})
    }
  })

  it('in auto mode, the wired backstop stands down — the classifier is the gate', async () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'auto' })
    const hook = options.hooks?.PreToolUse?.[0]?.hooks?.[0]
    expect(typeof hook).toBe('function')
    const writeInput = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: {},
      tool_use_id: 't',
      session_id: 's',
      transcript_path: '',
      cwd: '/tmp/ws',
    } as never
    const writeResult = await hook!(writeInput, undefined, { signal: new AbortController().signal })
    // No 'ask' — auto defers even Write to Anthropic's classifier (no hardcoded floor).
    expect(writeResult).toEqual({})
  })

  it('threads askModeApprovalToolNames into the wired backstop — cards in ask, silent in bypass', async () => {
    const askSet = new Set(['mcp__vynel__remove_knowledge_source'])
    const tierInput = {
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__vynel__remove_knowledge_source',
      tool_input: {},
      tool_use_id: 't',
      session_id: 's',
      transcript_path: '',
      cwd: '/tmp/ws',
    } as never
    const hookOptions = { signal: new AbortController().signal }

    const askOptions = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      askModeApprovalToolNames: askSet,
    })
    const askHook = askOptions.hooks?.PreToolUse?.[0]?.hooks?.[0]
    const askResult = (await askHook!(tierInput, undefined, hookOptions)) as {
      hookSpecificOutput?: { permissionDecision?: string }
    }
    expect(askResult.hookSpecificOutput?.permissionDecision).toBe('ask')

    const bypassOptions = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'bypass-with-behavior-gate',
      askModeApprovalToolNames: askSet,
    })
    const bypassHook = bypassOptions.hooks?.PreToolUse?.[0]?.hooks?.[0]
    expect(await bypassHook!(tierInput, undefined, hookOptions)).toEqual({})
  })

  it('does NOT register a PostCompact hook unless one is supplied', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.hooks?.PostCompact).toBeUndefined()
    // The always-on backstop is unaffected.
    expect(options.hooks?.PreToolUse).toBeDefined()
  })

  it('registers a supplied PostToolUse hook (the mid-turn context channel) only when supplied', () => {
    expect(buildClaudeSdkOptions({ ...base, permissionMode: 'ask' }).hooks?.PostToolUse).toBeUndefined()
    const noopHook = (async () => ({})) as never
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask', postToolUseHook: noopHook })
    expect(options.hooks?.PostToolUse?.[0]?.hooks?.[0]).toBe(noopHook)
    expect(options.hooks?.PreToolUse).toBeDefined()
  })

  it('registers a supplied PostCompact hook alongside PreToolUse', () => {
    const noopHook = (async () => ({})) as never
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      postCompactHook: noopHook,
    })
    expect(options.hooks?.PreToolUse).toBeDefined()
    expect(options.hooks?.PostCompact?.[0]?.hooks?.[0]).toBe(noopHook)
  })
})
