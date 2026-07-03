// `buildMemorySessionContribution` — the memory capability's contribution to
// the agent's system-prompt append: the "how to use memory" instruction plus a
// rendered snapshot of the workspace's top memory entries. The session composer
// calls this when the memory capability is enabled. Sync (Phase 1 DB read); no
// mention is recorded (the snapshot is built pre-turn, before the SDK assigns a
// session id).

import type { Database } from '@vynel/db'
import type { MemoryEntry, MemoryEntryKind } from '../repositories/index.js'
import { loadWorkspaceContextForSession } from './load-workspace-context-for-session.js'

export const MEMORY_AGENT_INSTRUCTIONS = `You have a persistent memory of facts about this user and their work — shown below, and searchable with the memory tools. Ground your responses in it: when the user refers to "me", "my business", or to people and projects, treat these facts as the source of truth. If a fact you need isn't here and isn't in the conversation, ask rather than guess.`

const KIND_HEADINGS: Record<MemoryEntryKind, string> = {
  person: 'People',
  preference: 'Preferences',
  'business-fact': 'Business facts',
  'recurring-pattern': 'Recurring patterns',
  note: 'Notes',
}

function renderSnapshot(topEntriesByKind: Record<MemoryEntryKind, MemoryEntry[]>): string {
  const blocks: string[] = []
  for (const [kind, heading] of Object.entries(KIND_HEADINGS) as [MemoryEntryKind, string][]) {
    const entries = topEntriesByKind[kind] ?? []
    if (entries.length === 0) continue
    const lines = entries.map((entry) => `- ${entry.body}`).join('\n')
    blocks.push(`### ${heading}\n${lines}`)
  }
  return blocks.join('\n\n')
}

export function buildMemorySessionContribution(
  db: Database,
  input: { workspaceId: string },
): string {
  const snapshot = loadWorkspaceContextForSession(db, { workspaceId: input.workspaceId })
  const rendered = renderSnapshot(snapshot.topEntriesByKind)
  return rendered.length > 0
    ? `${MEMORY_AGENT_INSTRUCTIONS}\n\n## What you already know (workspace memory)\n${rendered}`
    : MEMORY_AGENT_INSTRUCTIONS
}
