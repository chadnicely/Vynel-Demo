// `composeSessionAgents` — the orchestration entry point for "what agents
// are live in this session." Thin in Mode A: it delegates to the `agents`
// domain's `resolveEnabledAgentsForSession`, returning the SDK
// `Record<string, AgentDefinition>` the chat session-start path passes to
// `query({ agents })`. Mode B (deterministic plans) would layer here later.
//
// Reaches `agents` through its public package surface (`@vynel/agents`), never
// its kernel repositories (`@vynel/db/repositories/agents`) — the cross-domain
// rule (coordination depends on the noun's public surface, not its data layer).
// Acyclic: `agents` does not depend on `orchestration`.

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import { resolveEnabledAgentsForSession } from '@vynel/agents'

export type ComposeSessionAgentsInput = {
  userId: string
  workspaceId: string
}

export async function composeSessionAgents(
  db: Database,
  input: ComposeSessionAgentsInput,
): Promise<Record<string, AgentDefinition>> {
  return resolveEnabledAgentsForSession(db, input)
}
