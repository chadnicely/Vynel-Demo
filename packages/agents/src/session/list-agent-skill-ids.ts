// Thin core read exposing an agent's preloaded skill ids to the route
// layer — so the agents routes enrich their responses through
// `@vynel/agents` rather than importing `@vynel/db/repositories/agents`
// directly (the route→core→repo layering; matches the skills-route
// precedent). Code-review M2 from the agents foundation, folded in now
// that the agents surface is wired live.

import type { Database } from '@vynel/db'
import * as agentsRepository from '@vynel/db/repositories/agents'

export async function listAgentSkillIds(db: Database, agentId: string): Promise<string[]> {
  return agentsRepository.listSkillIdsForAgent(db, agentId)
}
