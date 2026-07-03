// The Phase-1 curated-agent catalog — a TypeScript constant array,
// compiled into the app (no runtime catalog fetch). Mirrors
// `VERIFIED_SKILL_CATALOG`: bundled-in keeps offline reliability +
// versioning unambiguous + the trust story sound.
//
// These are the Vynel-CURATED agents (`source: 'vynel'`,
// `trustTier: 'verified'`). The other two sources — user-built (the
// in-app agent builder) and community (marketplace) — are follow-up
// units; the `agents` schema is already authored-ready for them.
//
// Phase-1 catalog (3 entries):
//   - document-generator — write-capable, file-only allowlist
//   - researcher         — read-only, runs on `sonnet`
//   - inbox-assistant    — preloads the `email-drafter` skill
//
// Adding a curated agent stays a 3-line edit (file + import + entry).

import { documentGeneratorAgent } from './document-generator.js'
import { researcherAgent } from './researcher.js'
import { inboxAssistantAgent } from './inbox-assistant.js'
import type { CuratedAgentDefinition } from './curated-agent-definition.js'

export const CURATED_AGENT_CATALOG = [
  documentGeneratorAgent,
  researcherAgent,
  inboxAssistantAgent,
] as const satisfies readonly CuratedAgentDefinition[]

/**
 * Looks up a curated-agent catalog entry by slug. Returns `null` when
 * no entry matches.
 */
export function findCuratedAgentBySlug(slug: string): CuratedAgentDefinition | null {
  return CURATED_AGENT_CATALOG.find((agent) => agent.slug === slug) ?? null
}
