/* eslint-disable no-console */
// One-shot LIVE smoke — run MANUALLY, not part of the test suite.
//
// Question: does the Agent SDK populate `agent_id` on the PreToolUse hook input
// for a SUBAGENT's tool calls (and leave it undefined for the main session)?
//
// Why it matters: the auto-mode floor stand-down depends on this exact runtime
// fact. `src/claude/internal/build-claude-pre-tool-use-hook.ts` stands the Vynel
// floor down in `auto` ONLY for the main session (`agent_id === undefined`) and
// keeps it for any subagent (`agent_id` present) — so a bypass subagent under an
// auto root still gets a card. The SDK docs say agent_id is "Present when the
// hook fires from within a subagent" (sdk.d.ts), but a sibling auto-mode doc
// claim (subagent inheritance) was already wrong, so we confirm THIS one live.
//
// Run:
//   cd packages/providers && npx -y tsx scripts/smoke-subagent-agent-id.ts
// Auth: uses the host Claude Code login / ANTHROPIC_API_KEY (same as Vynel).
// Env:  SMOKE_MODE (default "auto") — set "bypassPermissions" if your account
//       can't use auto mode. agent_id population is mode-independent, so a
//       bypass-mode run is a valid proxy for the same fact.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '../src/claude/base/claude-agent-sdk.js'

const sessionMode = process.env.SMOKE_MODE ?? 'auto'
const cwd = mkdtempSync(join(tmpdir(), 'vynel-agentid-smoke-'))

type Seen = { tool: string; agentId: string | undefined; agentType: string | undefined }
const seen: Seen[] = []

console.log(`[smoke] permissionMode=${sessionMode}  cwd=${cwd}`)
console.log('[smoke] asking the model to delegate a file write to a bypass subagent...\n')

async function main(): Promise<number> {
  const run = query({
    prompt:
      'You have a subagent named "writer". Delegate to it (via your Task/subagent tool) the job of ' +
      'creating a file named hello.txt containing the text "hi". Do NOT write the file yourself — the ' +
      'writer subagent must create it. Then stop.',
    options: {
      cwd,
      // tsx transpiles without type-checking, so the loose string is fine here.
      permissionMode: sessionMode as 'auto' | 'bypassPermissions',
      agents: {
        writer: {
          description: 'Creates a file when asked, using the Write tool.',
          prompt: 'Create exactly the file you are asked for using the Write tool, then stop.',
          tools: ['Write'],
          // The exact case the safety fix guards: a bypass subagent under the root.
          permissionMode: 'bypassPermissions',
        },
      },
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                const it = input as {
                  hook_event_name?: string
                  tool_name?: string
                  agent_id?: string
                  agent_type?: string
                }
                if (it.hook_event_name === 'PreToolUse') {
                  seen.push({
                    tool: it.tool_name ?? '?',
                    agentId: it.agent_id,
                    agentType: it.agent_type,
                  })
                  console.log(
                    `[PreToolUse] tool=${it.tool_name} agent_id=${it.agent_id ?? '<undefined>'} agent_type=${it.agent_type ?? '<undefined>'}`,
                  )
                }
                return {}
              },
            ],
          },
        ],
      },
    },
  })

  for await (const _message of run) {
    // drain to completion
  }

  console.log('\n=== SMOKE RESULT ===')
  const subagent = seen.filter((entry) => entry.agentId !== undefined)
  const mainThread = seen.filter((entry) => entry.agentId === undefined)
  console.log(`PreToolUse calls: ${seen.length}  (main: ${mainThread.length}, subagent: ${subagent.length})`)

  if (subagent.length > 0) {
    console.log(
      '\n[PASS] agent_id IS populated on subagent PreToolUse calls.\n' +
        '       The auto-mode floor stand-down is SAFE: subagents keep the floor backstop.',
    )
    return 0
  }
  if (seen.length === 0) {
    console.log('\n[INCONCLUSIVE] no tool calls observed — the model did not act. Re-run.')
    return 3
  }
  console.log(
    '\n[FAIL/INCONCLUSIVE] tool calls happened but NONE carried agent_id.\n' +
      '       If a Write above shows agent_id=<undefined>, the auto stand-down is UNSAFE.\n' +
      '       (Also possible: the model wrote the file itself instead of delegating — re-run.)',
  )
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n[smoke] errored: ${err instanceof Error ? err.message : String(err)}`)
    console.error('[smoke] if this is an auto-mode availability error, re-run with SMOKE_MODE=bypassPermissions')
    process.exit(2)
  })
