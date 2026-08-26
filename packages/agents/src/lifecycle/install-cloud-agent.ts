// Installs an agent downloaded from the cloud marketplace — the
// artifact-sourced twin of `installCuratedAgent` (which renders a
// compiled-in definition). Mirrors skills' `install-cloud-skill.ts`:
//   1. VERIFY sha256(bytes) against the catalog's recorded hash —
//      integrity FIRST, so nothing untrusted is ever parsed.
//   2. Extract + zod-parse agent.json from the (now-trusted) archive.
//   3. Enforce manifest.slug === itemId — the install-status annotation
//      keys agents on slug === itemId; a mismatch would install an agent
//      whose marketplace card never flips to "Installed".
//   4. Delegate to `createAgent` (duplicate pre-check +
//      transparency mirror at `.claude/agents/<slug>.md` + `createAgent`
//      row/outbox tx), stamping `source: 'community'` +
//      `trustTier: 'community'`. The DB row stays the FUNCTIONAL source
//      of truth (resolved into `query({ agents })` at session start);
//      the mirror is disk visibility, lifecycle-synced.
//
// Throws: ValidationError (sha mismatch / bad archive / bad manifest /
// slug≠itemId), ConflictError (slug already exists at scope).

import { createHash } from 'node:crypto'
import type { Database } from '@vynel/db'
import { ValidationError } from '@vynel/errors'
import { extractAgentManifest } from '../internal/extract-agent-manifest.js'
import type { CreateAgentInput } from './create-agent.js'
import { createAgent } from './create-agent.js'
import type { AgentRow, AgentScope, StructuralLogger } from '../agents-types.js'

export type InstallCloudAgentInput = {
  userId: string
  // null = a user-scope install with no workspace in play (the GLOBAL
  // marketplace surface). A 'workspace' scope REQUIRES non-null.
  workspaceId: string | null
  itemId: string
  scope: AgentScope
  artifactBytes: Buffer
  expectedSha256: string
}

export async function installCloudAgent(
  db: Database,
  input: InstallCloudAgentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<AgentRow> {
  // 0. A workspace-scope install must carry its workspace id (fail fast —
  //    createAgent derives scope FROM workspaceId, so a null here would
  //    silently install at user scope instead).
  if (input.scope === 'workspace' && input.workspaceId === null) {
    throw new ValidationError(
      'A workspace-scope agent install needs its workspace id — pass it, or install at user scope.',
    )
  }

  // 1. Integrity check FIRST — never parse unverified bytes. Lowercase
  //    both sides: digest('hex') emits lowercase, but a hub record may
  //    carry uppercase hex — casing must never fail a valid hash.
  const actualSha256 = createHash('sha256').update(input.artifactBytes).digest('hex')
  if (actualSha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
    throw new ValidationError(
      'The downloaded agent failed its integrity check (sha256 mismatch) — install aborted.',
    )
  }

  // 2. Extract + validate the manifest from the verified archive.
  const manifest = await extractAgentManifest(input.artifactBytes)

  // 3. The id anchor: itemId === slug, or install-status annotation drifts.
  if (manifest.slug !== input.itemId) {
    throw new ValidationError(
      `The agent manifest's slug ("${manifest.slug}") must match the catalog itemId ("${input.itemId}") — ask the publisher to fix and re-publish.`,
    )
  }

  // 4. `createAgent` owns the duplicate pre-check, the disk
  //    mirror, and the delegated `createAgent` tx. Carding is NOT
  //    tier-gated: the provider's PreToolUse hook enforces the
  //    TOOLS_ALWAYS_REQUIRING_APPROVAL floor per the SESSION's mode (it
  //    stands down only for auto and the user's bypass — 2026-07-30
  //    stance), and the manifest schema clamps permissionMode to the safe
  //    subset.
  //    `trustTier: 'community'` gates nothing at runtime today — it is a
  //    recorded provenance label reserved for future per-tier gating.
  const createInput: CreateAgentInput = {
    userId: input.userId,
    workspaceId: input.scope === 'workspace' ? input.workspaceId : null,
    slug: manifest.slug,
    name: manifest.name,
    description: manifest.description,
    prompt: manifest.prompt,
    source: 'community',
    trustTier: 'community',
    enabled: true,
  }
  // Conditionally carry the optional runtime fields
  // (exactOptionalPropertyTypes — never assign undefined).
  if (manifest.icon !== undefined) createInput.icon = manifest.icon
  if (manifest.model !== undefined) createInput.model = manifest.model
  if (manifest.effort !== undefined) createInput.effort = manifest.effort
  if (manifest.permissionMode !== undefined) createInput.permissionMode = manifest.permissionMode
  if (manifest.allowedTools !== undefined) createInput.allowedTools = manifest.allowedTools
  if (manifest.disallowedTools !== undefined) createInput.disallowedTools = manifest.disallowedTools

  const installed = await createAgent(db, createInput, deps)
  deps.logger?.info(
    { itemId: input.itemId, scope: input.scope, agentId: installed.id },
    'cloud agent installed',
  )
  return installed
}
