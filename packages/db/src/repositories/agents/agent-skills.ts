// Functional repository for the `agent_skills` child table — the set of
// Vynel skill identifiers an agent preloads (→ `AgentDefinition.skills`).
// `db` first arg, stateless. Spec: `docs/agent-base/agents.md`.
//
// No tenant `userId` column here — isolation is FK-transitive via
// `agentId → agents.userId` (the `skill_settings` precedent). Callers
// that mutate must own the parent agent (enforced at the core layer).

import { asc, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../client.js'
import { agentSkills, type AgentSkillRow, type NewAgentSkillRow } from '../../schema/agents/agent-skills.js'

export type { AgentSkillRow, NewAgentSkillRow } from '../../schema/agents/agent-skills.js'

// The skill identifiers preloaded by one agent, ordered for a stable
// `AgentDefinition.skills` array.
export function listSkillIdsForAgent(db: Database, agentId: string): string[] {
  return db
    .select({ skillId: agentSkills.skillId })
    .from(agentSkills)
    .where(eq(agentSkills.agentId, agentId))
    .orderBy(asc(agentSkills.skillId))
    .all()
    .map((row) => row.skillId)
}

// Batched skill-id lookup for many agents — one query instead of N (the
// session resolver's hot path). Returns a Map with an entry for EVERY
// requested agentId (empty array when the agent has no preloaded skills),
// so callers can index without a presence check.
export function listSkillIdsForAgents(
  db: Database,
  agentIds: string[],
): Map<string, string[]> {
  const skillIdsByAgentId = new Map<string, string[]>()
  for (const agentId of agentIds) skillIdsByAgentId.set(agentId, [])
  if (agentIds.length === 0) return skillIdsByAgentId

  const rows = db
    .select({ agentId: agentSkills.agentId, skillId: agentSkills.skillId })
    .from(agentSkills)
    .where(inArray(agentSkills.agentId, agentIds))
    .orderBy(asc(agentSkills.agentId), asc(agentSkills.skillId))
    .all()
  for (const row of rows) {
    skillIdsByAgentId.get(row.agentId)?.push(row.skillId)
  }
  return skillIdsByAgentId
}

export function insertAgentSkill(db: Database, newRow: NewAgentSkillRow): AgentSkillRow {
  const [inserted] = db.insert(agentSkills).values(newRow).returning().all()
  if (!inserted) {
    throw new Error('insertAgentSkill: no row returned')
  }
  return inserted
}

// Removes every preload row for an agent — the first half of the
// delete-then-insert "replace" pattern the core layer uses when an
// agent's skill set changes (run inside the same transaction as the
// re-insert). Returns the count removed.
export function deleteAgentSkillsForAgent(db: Database, agentId: string): number {
  const deleted = db.delete(agentSkills).where(eq(agentSkills.agentId, agentId)).returning().all()
  return deleted.length
}
