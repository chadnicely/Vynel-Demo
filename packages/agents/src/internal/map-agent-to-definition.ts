// Pure mapper: an `agents` row + its preloaded skill ids → the SDK
// `AgentDefinition` (`@anthropic-ai/claude-agent-sdk`). This is the
// single place the Vynel agent shape is translated to the runtime
// contract `query({ agents })` consumes — the locked decision is "an
// agent = SDK AgentDefinition + Vynel metadata; don't invent a
// parallel runtime shape" (`docs/agent-base/agents.md`).
//
// `import type` only — the SDK's runtime stays behind the
// `AiAgentProvider` abstraction; core borrows just the data shape.
//
// `exactOptionalPropertyTypes` is on, so every optional field is
// CONDITIONALLY assigned (never set to `undefined`). `null` columns
// mean "inherit from the main session", so they are simply omitted —
// the SDK treats an absent field as inherit. Per-agent `memory` is a
// later unit (the schema has no memory column yet), so it is not mapped
// here.

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRow } from '@vynel/db/repositories/agents'

export function mapAgentToDefinition(agent: AgentRow, skillIds: string[]): AgentDefinition {
  const definition: AgentDefinition = {
    description: agent.description,
    prompt: agent.prompt,
  }
  if (agent.allowedTools !== null) definition.tools = agent.allowedTools
  if (agent.disallowedTools !== null) definition.disallowedTools = agent.disallowedTools
  if (agent.model !== null) definition.model = agent.model
  if (agent.effort !== null) definition.effort = agent.effort
  if (agent.permissionMode !== null) definition.permissionMode = agent.permissionMode
  if (skillIds.length > 0) definition.skills = skillIds
  // `background` is NOT NULL; only emit it when true to keep the
  // definition minimal (false = the SDK default).
  if (agent.background) definition.background = agent.background
  return definition
}
