// The Phase 1 Verified-skill catalog — a TypeScript constant
// array, compiled into the app. No runtime catalog fetch in
// Phase 1 (D2 — bundled-in-binary keeps offline reliability +
// versioning unambiguous + trust story sound).
//
// **Phase 1 catalog: 1 entry** (per the user-directive + D2):
//   - `email-drafter`         — user-installable (D2)
//
// `workspace-context` (the former system-installed entry, D3) was
// retired in A2 — its agent protocol now lives in
// `VYNEL_AGENT_INSTRUCTIONS` (the capability-platform system-prompt
// append), so a per-workspace skill duplicating it is redundant. The
// `isSystemInstalled` mechanism is retained for any future
// system-installed bundle.
//
// The architecture stays multi-skill-ready: adding a skill is
// (a) write `<skill-id>.ts`, (b) add the import, (c) add the
// array entry. No schema migration; no installer change; no
// UI change.

import { emailDrafterSkill } from './email-drafter.js'
import type { VerifiedSkillDefinition, SkillCategory } from './verified-skill-definition.js'

// Phase 1 catalog (1 entry):
// - `email-drafter`        — user-installable (D2)
// Adding a skill remains a 3-line edit (file + import + entry).

export const VERIFIED_SKILL_CATALOG = [
  emailDrafterSkill,
] as const satisfies readonly VerifiedSkillDefinition[]

/**
 * Looks up a catalog entry by id. Returns `null` when no entry
 * matches — `external` skills discovered via
 * `synchronizeSkillsWithProvider` return null here (their
 * `skillId` is the provider-reported name, not a catalog id).
 */
export function findVerifiedSkillById(skillId: string): VerifiedSkillDefinition | null {
  return VERIFIED_SKILL_CATALOG.find((s) => s.skillId === skillId) ?? null
}

/**
 * Returns every catalog entry in the given category. Useful for
 * the marketplace's category-tab UX (Phase 1.5+).
 */
export function listVerifiedSkillsByCategory(category: SkillCategory): VerifiedSkillDefinition[] {
  return VERIFIED_SKILL_CATALOG.filter((s) => s.category === category)
}
