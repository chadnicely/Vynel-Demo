// Updates a Vynel agent's persona/runtime/tool fields and (optionally)
// its preloaded-skill set. Ownership is enforced by the `userId` filter
// in the repo update; a miss → `NotFoundError`. Spec:
// `docs/agent-base/agents.md`.
//
// `skillIds` is OPTIONAL: when omitted, the preload set is left
// untouched; when provided, it REPLACES the set (delete-then-insert in
// the same transaction). This lets thin callers (e.g. the enable
// toggle) patch a single field without disturbing skills.
//
// Marketplace-sourced agents (source `community`/`vynel`) keep a disk
// transparency mirror (`.claude/agents/<slug>.md`) that must track the
// row: present exactly while enabled. This is LOAD-BEARING, not
// cosmetic — the SDK loads filesystem agents, and only a same-named
// programmatic definition shadows the file; a disabled agent's stale
// mirror would go LIVE from disk. So after the tx commits: disable
// removes the file, enable/edit rewrites it, a slug rename drops the
// old file (best-effort + marker-checked; the row is truth).

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type {
  AgentRow,
  AgentPatch,
  AgentEffort,
  AgentPermissionMode,
} from '@vynel/db/repositories/agents'
import type { StructuralLogger } from '../agents-types.js'
import {
  removeAgentMirrorOnDisk,
  syncAgentMirrorOnDisk,
} from '../internal/agent-mirror-on-disk.js'
import { AGENT_UPDATED, type AgentUpdatedPayload } from '../agents-events.js'

export type UpdateAgentInput = {
  agentId: string
  userId: string
  slug?: string
  name?: string
  description?: string
  icon?: string | null
  prompt?: string
  model?: string | null
  effort?: AgentEffort | null
  permissionMode?: AgentPermissionMode | null
  background?: boolean
  allowedTools?: string[] | null
  disallowedTools?: string[] | null
  enabled?: boolean
  // When provided, REPLACES the agent's preloaded-skill set.
  skillIds?: string[]
}

export async function updateAgent(
  db: Database,
  input: UpdateAgentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<AgentRow> {
  const existing = agentsRepository.findAgentById(db, input.agentId)
  if (!existing || existing.userId !== input.userId) {
    // Same response for not-found and not-owned — no enumeration leak.
    throw new NotFoundError('agent', input.agentId)
  }

  // Reject a slug rename that would collide with another live agent at
  // the same scope (the partial unique index is the hard backstop).
  if (input.slug !== undefined && input.slug !== existing.slug) {
    const clash = agentsRepository.findAgentBySlug(db, {
      userId: input.userId,
      workspaceId: existing.workspaceId,
      slug: input.slug,
    })
    if (clash) {
      throw new ConflictError(`An agent with slug "${input.slug}" already exists at this scope.`)
    }
  }

  // Build the patch from defined fields only (exactOptionalPropertyTypes
  // — never assign `undefined`).
  const patch: AgentPatch = {}
  if (input.slug !== undefined) patch.slug = input.slug
  if (input.name !== undefined) patch.name = input.name
  if (input.description !== undefined) patch.description = input.description
  if (input.icon !== undefined) patch.icon = input.icon
  if (input.prompt !== undefined) patch.prompt = input.prompt
  if (input.model !== undefined) patch.model = input.model
  if (input.effort !== undefined) patch.effort = input.effort
  if (input.permissionMode !== undefined) patch.permissionMode = input.permissionMode
  if (input.background !== undefined) patch.background = input.background
  if (input.allowedTools !== undefined) patch.allowedTools = input.allowedTools
  if (input.disallowedTools !== undefined) patch.disallowedTools = input.disallowedTools
  if (input.enabled !== undefined) patch.enabled = input.enabled

  const updated = withTransaction(db, (tx) => {
    const row = agentsRepository.updateAgent(tx, input.agentId, input.userId, patch)
    if (!row) {
      // Lost a race with a concurrent soft-delete between the find and
      // the update.
      throw new NotFoundError('agent', input.agentId)
    }
    if (input.skillIds !== undefined) {
      agentsRepository.deleteAgentSkillsForAgent(tx, input.agentId)
      for (const skillId of [...new Set(input.skillIds)]) {
        agentsRepository.insertAgentSkill(tx, { agentId: input.agentId, skillId })
      }
    }

    // Outbox co-commit — same transaction as the patch.
    const payload: AgentUpdatedPayload = {
      agentId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      slug: row.slug,
      scope: row.scope,
      updatedAt: row.updatedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: AGENT_UPDATED,
      payload,
      createdAt: row.updatedAt,
      processedAt: null,
    })

    return row
  })

  // Mirror sync AFTER the commit (header note). `source: 'user'` agents
  // never had a mirror — the disk is not touched for them.
  if (updated.source !== 'user') {
    if (updated.slug !== existing.slug) {
      await removeAgentMirrorOnDisk(
        db,
        { scope: existing.scope, workspaceId: existing.workspaceId, slug: existing.slug },
        deps.logger,
      )
    }
    await syncAgentMirrorOnDisk(db, updated, deps.logger)
  }

  deps.logger?.info({ agentId: input.agentId }, 'agent updated')
  return updated
}
