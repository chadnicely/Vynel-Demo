// Returns the catalog of available skills. Phase 1 = the bundled
// `VERIFIED_SKILL_CATALOG` constant; Phase 1.5+ may merge in a
// cloud-supplemented catalog (D2 trade-off).
//
// Sync — pure read of an in-memory constant.

import { VERIFIED_SKILL_CATALOG } from '@vynel/contracts/skills/verified-skills/verified-skill-catalog'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

export function listAvailableSkills(): readonly VerifiedSkillDefinition[] {
  return VERIFIED_SKILL_CATALOG
}
