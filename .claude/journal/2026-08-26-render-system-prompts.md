# 2026-08-26 — render Vynel's system prompt end to end (recipe)

Produces `docs/module-notes/instructions/vynel-system-prompt.md` through the real composer and descriptor sections. Copy the script to `apps/local-api/src/_render-prompts.ts` (it imports across packages, so it never lives in the tree), run `pnpm exec tsx apps/local-api/src/_render-prompts.ts` from the repo root, then delete it.

```ts
// TEMP (deleted after the run): renders Vynel's standing system prompt end to end, per session
// kind, through the real composer + descriptor sections, into docs/module-notes/instructions/.
import { writeFileSync } from 'node:fs'
import { composeSessionInstruction } from '@vynel/instructions/session-instructions'
import { vynelWorkspaceInteractiveDescriptor, vynelWorkspaceDescriptor } from '../../mcp/src/vynel-mcp-feature-descriptor.js'
import { NOTEBOOK_PROMPT_INSTRUCTIONS } from '../../../packages/instructions/src/mcp/notebook-mcp-feature-descriptor.js'
import { SESSION_PROMPT_INSTRUCTIONS } from '../../../packages/session/src/mcp/session-mcp-feature-descriptor.js'
import { ASK_PROMPT_INSTRUCTIONS } from '../../../packages/asks/src/mcp/ask-mcp-feature-descriptor.js'
import { SSH_PROMPT_INSTRUCTIONS } from '../../../packages/ssh-servers/src/mcp/ssh-mcp-feature-descriptor.js'
import { DESKTOP_TOOL_INSTRUCTIONS, DESKTOP_ACT_INSTRUCTIONS } from '../../../packages/desktop-control/src/mcp/desktop-tool-instructions.js'
import { MEMORY_AGENT_INSTRUCTIONS } from '../../../packages/memory/src/session/build-memory-session-contribution.js'
import { ROUTED_TASK_INSTRUCTIONS } from '../../../packages/session/src/delegation/routed-turn-provider-input.js'

const ALL_CAPABILITIES = new Set(['tasks', 'plans', 'phases', 'features', 'journal'])
const stubContext = {} as never
const workspaceSections = vynelWorkspaceInteractiveDescriptor.contributePrompt?.(stubContext, ALL_CAPABILITIES) ?? ''
const backgroundSections = vynelWorkspaceDescriptor.contributePrompt?.(stubContext, ALL_CAPABILITIES) ?? ''

type Part = { source: string; text: string; note?: string }
type Kind = { title: string; door: string; parts: Part[] }

const memoryPart: Part = {
  source: '@vynel/memory buildMemorySessionContribution (capability "memory" enabled)',
  text: `${MEMORY_AGENT_INSTRUCTIONS}\n\n## What you already know (workspace memory)\n### People\n- <top "context"-tagged entries, rendered per tag group — DB-dependent, omitted here>`,
  note: 'the snapshot lines come from the workspace DB; only the instruction text is static',
}

const kinds: Kind[] = [
  {
    title: 'Workspace MANAGER — interactive chat turn',
    door: 'apps/local-api/src/streams/chat-turn.ts → composeSessionCapabilities + composeSessionMcpServers',
    parts: [
      { source: 'session-instructions/base.md', text: composeSessionInstruction('workspace-manager').split('\n\n').slice(0, -1).join('\n\n'), note: 'base' },
      { source: 'session-instructions/workspace-manager.md', text: composeSessionInstruction('workspace-manager').split('\n\n').slice(-1).join(''), note: 'kind' },
      memoryPart,
      { source: 'apps/mcp vynelWorkspaceInteractiveDescriptor.contributePrompt (one section per enabled capability: tasks · plans · phases · features · journal)', text: workspaceSections },
      { source: '@vynel/instructions notebookFeatureDescriptor', text: NOTEBOOK_PROMPT_INSTRUCTIONS },
      { source: '@vynel/session sessionFeatureDescriptor', text: SESSION_PROMPT_INSTRUCTIONS },
      { source: '@vynel/asks askFeatureDescriptor', text: ASK_PROMPT_INSTRUCTIONS },
      { source: '@vynel/ssh-servers sshFeatureDescriptor (only when an SSH master key is configured)', text: SSH_PROMPT_INSTRUCTIONS },
    ],
  },
  {
    title: 'CHILD (spawned session) — routed task turn',
    door: 'packages/session/src/delegation/delegate-to-spawned-session.ts → composeSessionInstruction + composeRoutedTurnSystemPrompt',
    parts: [
      { source: 'session-instructions/base.md + spawned-session.md', text: composeSessionInstruction('spawned-session') },
      { source: 'routed-turn-provider-input.ts ROUTED_TASK_INSTRUCTIONS (or the caller\'s steer: NOTE_DELIVERY / CONTINUATION_TASK)', text: ROUTED_TASK_INSTRUCTIONS },
      { source: 'apps/mcp vynelWorkspaceDescriptor.contributePrompt (background variant — same sections, no session-spawning tools)', text: backgroundSections },
      { source: '@vynel/instructions notebookFeatureDescriptor', text: NOTEBOOK_PROMPT_INSTRUCTIONS },
      { source: '@vynel/session sessionFeatureDescriptor', text: SESSION_PROMPT_INSTRUCTIONS },
    ],
  },
  {
    title: 'GLOBAL BRAIN (global root) — chat turn',
    door: 'packages/session/src/runtime/run-global-root-turn-core.ts buildSystemPromptAppend',
    parts: [
      { source: 'session-instructions/base.md + global-root.md', text: composeSessionInstruction('global-root') },
      { source: 'routing descriptor — contributes NO standing prompt (the kind file names the routing tools)', text: '' },
      { source: '@vynel/instructions notebookFeatureDescriptor', text: NOTEBOOK_PROMPT_INSTRUCTIONS },
      { source: '@vynel/session sessionFeatureDescriptor', text: SESSION_PROMPT_INSTRUCTIONS },
      { source: '@vynel/desktop-control desktopFeatureDescriptor — DESKTOP_TOOL_INSTRUCTIONS always; DESKTOP_ACT_INSTRUCTIONS only while desktop control is granted', text: `${DESKTOP_TOOL_INSTRUCTIONS}\n\n${DESKTOP_ACT_INSTRUCTIONS}` },
      { source: 'per-turn steerPromptAppend (channel / schedule steers) — turn-specific, omitted', text: '' },
    ],
  },
  {
    title: 'GLOBAL BRAIN — VOICE turn',
    door: 'same door with voice: true → voice-base replaces base',
    parts: [{ source: 'session-instructions/voice-base.md + global-root.md', text: composeSessionInstruction('global-root', { voice: true }) }, { source: 'then the same feature sections as the global brain above', text: '' }],
  },
  {
    title: 'AGENT COLLEAGUE — routed or direct turn',
    door: 'delegate-to-agent-session.ts / session-turn.ts → composeAgentColleaguePrompt',
    parts: [
      { source: 'session-instructions/base.md + agent-colleague.md ({{agentName}} rendered)', text: composeSessionInstruction('agent-colleague', { agentName: 'Nova' }) },
      { source: 'the agent\'s own persona prompt (DB) — appended after the stack; then the routed instructions + the child\'s feature sections', text: '' },
    ],
  },
]

const tokens = (chars: number) => Math.round(chars / 3.6)
const fence = (text: string) => '```text\n' + text.replace(/```/g, "'''") + '\n```'

const summary = kinds.map((kind) => {
  const chars = kind.parts.reduce((sum, part) => sum + part.text.length, 0)
  return `| ${kind.title} | ${chars} | ≈${tokens(chars)} |`
}).join('\n')

const body = kinds.map((kind) => {
  const chars = kind.parts.reduce((sum, part) => sum + part.text.length, 0)
  const parts = kind.parts.map((part) => {
    const head = `### ${part.source}${part.note ? ` — _${part.note}_` : ''}`
    return part.text === '' ? head : `${head}\n\n${fence(part.text)}`
  }).join('\n\n')
  return `## ${kind.title}\n\n_Door: ${kind.door}_ · ${chars} chars ≈ ${tokens(chars)} tokens\n\n${parts}`
}).join('\n\n---\n\n')

const out = `# Vynel's system prompt — ours, end to end, per session kind (rendered 2026-08-26)

Rendered through the real composer (\`composeSessionInstruction\`) and the real descriptor sections
(\`McpFeatureDescriptor.contributePrompt\`, every capability enabled), in the order each door joins
them. Today this whole stack rides as \`append\` after Claude Code's preset
(\`claude-system-prompt.md\`); after the seam change it IS the system prompt. Parts marked
DB-dependent or per-turn are named, not rendered. Sizes exclude the preset and the tool
definitions. Re-render: \`pnpm exec tsx apps/local-api/src/_render-prompts.ts\` (script kept in the
2026-08-26 journal notes; re-create from \`claude-sdk-request-anatomy.md\` §3 if needed).

| Session kind | chars | ≈ tokens |
|---|---|---|
${summary}

Per-turn markers on the USER message (not in the system prompt): \`turn-time-marker.md\` (every
chat/voice/channel/schedule turn), \`voice-turn-marker.md\`, \`schedule-fire-marker.md\`,
\`autopilot-marker.md\`, the restart-survivor checkpoint line — and the planned
\`manager-turn-marker.md\`.

${body}
`

writeFileSync('docs/module-notes/instructions/vynel-system-prompt.md', out)
console.log(summary)
```
