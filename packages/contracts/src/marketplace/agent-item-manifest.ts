// The `agent.json` manifest inside a marketplace AGENT artifact (zip) —
// validated desktop-side AT INSTALL (`@vynel/agents` installCloudAgent),
// after the artifact's sha256 is verified. The hub never parses it
// (manifests are opaque hub-side by design: "a new kind needs no hub
// change"), so this zod schema is the single trust boundary between
// community bytes and an `agents` row. Lives in `@vynel/contracts`
// because contracts already ships zod values (onboarding-step-inputs
// precedent) and the seed/publish tooling shares the shape. Consumers
// import the file directly (`@vynel/contracts/marketplace/
// agent-item-manifest`); no barrel.
//
// No `skillIds` in v1 — cross-item dependency resolution is its own arc.
// Unknown keys are STRIPPED (zod default), so a future additive field
// doesn't break older desktops.

import { z } from 'zod'

// Same shape class as skills' SAFE_SKILL_ID — the slug becomes the
// `@mention` handle and must equal the catalog itemId (enforced at
// install so the install-status annotation, keyed slug === itemId,
// can't silently drift).
const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const AgentItemManifestSchema = z.object({
  slug: z.string().min(1).max(64).regex(KEBAB_SLUG, 'slug must be kebab-case'),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  // 50_000 matches the user-create route's prompt cap — a community
  // artifact must not out-bound what the user's own hands can create.
  prompt: z.string().min(1).max(50_000),
  /** Lucide icon name for the Agents panel. */
  icon: z.string().min(1).max(64).optional(),
  /** Model alias or full id; omit to inherit the session model. */
  model: z.string().min(1).max(120).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  // Only the SAFE subset of `AgentPermissionMode` — a community artifact
  // never gets to model the approval-card-skip pattern
  // (`bypassPermissions`/`dontAsk`/`auto`); see the agents schema note.
  permissionMode: z.enum(['default', 'acceptEdits', 'plan']).optional(),
  allowedTools: z.array(z.string().min(1).max(120)).max(64).optional(),
  disallowedTools: z.array(z.string().min(1).max(120)).max(64).optional(),
})

export type AgentItemManifest = z.infer<typeof AgentItemManifestSchema>
