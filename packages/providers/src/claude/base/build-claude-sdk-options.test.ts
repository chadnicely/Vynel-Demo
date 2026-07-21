// Tests for `buildClaudeSdkOptions` — the Vynel→SDK options mapping.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { describe, expect, it } from 'vitest'
import { buildClaudeSdkOptions } from './build-claude-sdk-options.js'

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

  it('maps "bypass-with-behavior-gate" to bypassPermissions + the acknowledgement flag', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'bypass-with-behavior-gate' })
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.allowDangerouslySkipPermissions).toBe(true)
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

  it('sets allowedTools / disallowedTools only when the name lists are non-empty', () => {
    const empty = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(empty.allowedTools).toBeUndefined()
    expect(empty.disallowedTools).toBeUndefined()

    const withTools = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      allowedToolNames: ['Read'],
      deniedToolNames: ['Bash'],
    })
    expect(withTools.allowedTools).toEqual(['Read'])
    expect(withTools.disallowedTools).toEqual(['Bash'])
  })

  it('forwards mcpServers + merges allowedMcpToolPatterns into allowedTools', () => {
    // Per docs/blueprints/mcp/ D2 + D5 + D12 wire-in. The pre-built
    // server instance is forwarded verbatim; the wildcard is appended
    // to the existing allowedToolNames so the LLM can call any
    // `mcp__vynel__*` tool the in-process server registered.
    const fakeServer = { type: 'mcp', name: 'vynel', instance: {} } as never
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      allowedToolNames: ['Read', 'Grep'],
      mcpServers: { vynel: fakeServer },
      allowedMcpToolPatterns: ['mcp__vynel__*'],
    })
    expect(options.mcpServers).toEqual({ vynel: fakeServer })
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'mcp__vynel__*'])
  })

  it('omits mcpServers when not provided (regression — existing chat flows unchanged)', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.mcpServers).toBeUndefined()
  })

  it('merges only allowedMcpToolPatterns when mcpServers is absent (chat without MCP)', () => {
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      allowedToolNames: ['Read'],
      allowedMcpToolPatterns: ['mcp__future__*'],
    })
    expect(options.mcpServers).toBeUndefined()
    expect(options.allowedTools).toEqual(['Read', 'mcp__future__*'])
  })

  it('appends systemPromptAppend to the Claude Code preset system prompt', () => {
    const options = buildClaudeSdkOptions({
      ...base,
      permissionMode: 'ask',
      systemPromptAppend: 'You are Vynel.',
    })
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'You are Vynel.',
    })
  })

  it('omits append when systemPromptAppend is not provided (bare preset — regression)', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('forwards agents to the SDK options when provided, omits them otherwise', () => {
    const agents = { researcher: { description: 'Researches.', prompt: 'You research.' } }
    const withAgents = buildClaudeSdkOptions({ ...base, permissionMode: 'ask', agents })
    expect(withAgents.agents).toEqual(agents)

    const withoutAgents = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(withoutAgents.agents).toBeUndefined()
  })

  it('always wires the PreToolUse safety backstop, in every permission mode', async () => {
    for (const permissionMode of ['ask', 'bypass-with-behavior-gate', 'plan-only'] as const) {
      const options = buildClaudeSdkOptions({ ...base, permissionMode })
      const preToolUse = options.hooks?.PreToolUse
      expect(preToolUse, `hooks wired for ${permissionMode}`).toBeDefined()
      const hook = preToolUse?.[0]?.hooks?.[0]
      expect(typeof hook).toBe('function')

      // The wired hook forces 'ask' for an irreversible tool (→ canUseTool card)
      // and stays silent for a safe one — even in bypass mode.
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
      expect(
        (writeResult as { hookSpecificOutput?: { permissionDecision?: string } })
          .hookSpecificOutput?.permissionDecision,
      ).toBe('ask')

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

  it('does NOT register a PostCompact hook unless one is supplied', () => {
    const options = buildClaudeSdkOptions({ ...base, permissionMode: 'ask' })
    expect(options.hooks?.PostCompact).toBeUndefined()
    // The always-on backstop is unaffected.
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
