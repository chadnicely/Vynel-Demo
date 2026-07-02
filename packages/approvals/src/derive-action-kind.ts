// The closed action-kind taxonomy (D2). Pure function — same input,
// same output. The mapping table is the single source of truth for the
// taxonomy; adding a new kind is a deliberate multi-file change.
//
// Phase 1 maps Claude's tool names + the common mcp__*__* patterns.
// Trigger to revisit (D2): when the second concrete provider lands
// (Codex / Gemini / Cursor) — additional prefixes get appended; the
// `ActionKind` union stays stable.

import type { ActionKind } from './approvals-types.js'

export type ActionKindMapping = {
  readonly toolNamePrefixes: readonly string[]
  readonly toolNameExact: readonly string[]
  readonly actionKind: ActionKind
}

export const ACTION_KIND_MAPPINGS: readonly ActionKindMapping[] = [
  { toolNameExact: ['Write'], toolNamePrefixes: [], actionKind: 'file-write' },
  {
    toolNameExact: ['Edit', 'MultiEdit', 'NotebookEdit'],
    toolNamePrefixes: [],
    actionKind: 'file-edit',
  },
  {
    toolNameExact: ['Bash', 'BashOutput', 'KillShell'],
    toolNamePrefixes: [],
    actionKind: 'shell-command',
  },
  {
    toolNameExact: [],
    toolNamePrefixes: ['mcp__gmail__send', 'mcp__email__send'],
    actionKind: 'email-send',
  },
  {
    toolNameExact: [],
    toolNamePrefixes: ['mcp__google_calendar__create', 'mcp__calendar__create'],
    actionKind: 'calendar-write',
  },
  {
    toolNameExact: [],
    toolNamePrefixes: ['mcp__vynel_memory__write', 'mcp__vynel_memory__add'],
    actionKind: 'memory-write',
  },
] as const

const WRITE_SHAPED_VERBS = [
  'create',
  'delete',
  'send',
  'update',
  'modify',
  'add',
  'remove',
  'post',
] as const

export function deriveActionKind(toolName: string): ActionKind {
  for (const mapping of ACTION_KIND_MAPPINGS) {
    if (mapping.toolNameExact.includes(toolName)) return mapping.actionKind
    if (mapping.toolNamePrefixes.some((prefix) => toolName.startsWith(prefix)))
      return mapping.actionKind
  }
  // Unrecognized mcp__*__* tools that contain a write-shaped verb in their
  // suffix fall into the generic 'external-action' bucket so they still
  // surface as a card. Read-shaped mcp tools without write verbs fall to
  // 'other' — the chat surface bypasses approvals for safe reads anyway.
  if (
    toolName.startsWith('mcp__') &&
    WRITE_SHAPED_VERBS.some((verb) => toolName.toLowerCase().includes(verb))
  ) {
    return 'external-action'
  }
  return 'other'
}
