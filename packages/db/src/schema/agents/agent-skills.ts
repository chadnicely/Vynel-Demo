// The `agent_skills` table — the Vynel skills an agent preloads into
// its context (→ `AgentDefinition.skills[]`, the SDK's array of skill
// names to preload). A CHILD table (not a JSON column on `agents`)
// because the set is filtered/joined and benefits from referential
// integrity + cascade. Spec: `docs/agent-base/agents.md` "Schema
// (proposed)".
//
// FK is on `agentId` ONLY (cascade) — there is NO `skills` TABLE to
// reference. Skills live as a compiled-in catalog
// (`VERIFIED_SKILL_CATALOG`) + per-install rows (`installed_skills`);
// neither is the right FK target for an agent's *declared* preload set
// (the agent may be defined before the skill is installed in any given
// workspace). So `skillId` is the catalog/skill IDENTIFIER string
// (e.g. `email-drafter`) — exactly the value that flows into
// `AgentDefinition.skills`. This is a noted, deliberate interpretation
// of the blueprint's literal "skillId → skills FK" (impossible — no
// such table).
//
// Composite PK `(agentId, skillId)` prevents the same skill being
// preloaded twice for one agent — mirrors `skill_settings`'
// `(installedSkillId, settingKey)`.
//
// `onDelete: 'cascade'` means a hard-deleted (purged) agent drops its
// preload rows automatically.

import { table, id, text, primaryKey } from '@vynel/db/dialect'
import { agents } from './agents.js'

export const agentSkills = table(
  'agent_skills',
  {
    agentId: id().references(() => agents.id, { onDelete: 'cascade' }),
    skillId: text().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.skillId] }),
  }),
)

export type AgentSkillRow = typeof agentSkills.$inferSelect
export type NewAgentSkillRow = typeof agentSkills.$inferInsert
