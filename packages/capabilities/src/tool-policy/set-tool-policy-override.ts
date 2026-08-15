// `setToolPolicyOverride` — upsert one tool's override row (the admin
// matrix's PUT). Full-replace semantics: the request carries the WHOLE
// override set for the tool; an all-null save is normalized to a delete so
// "everything back to inherit" leaves no row behind. Co-commits the
// `tool-policy.updated` outbox event in one transaction (invariant #5).

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  deleteToolPolicy,
  findToolPolicy,
  insertToolPolicy,
  updateToolPolicy,
  type ToolPolicyRow,
} from '../repositories/tool-policies.js'
import { TOOL_POLICY_UPDATED, type ToolPolicyUpdatedPayload } from './tool-policy-events.js'
import type { SessionSurfaceKind, ToolCardClass } from './tool-policy-types.js'

export type SetToolPolicyOverrideInput = {
  userId: string
  toolName: string
  /** null = inherit (the columns' own vocabulary — see the schema header). */
  enabled: boolean | null
  cardClass: ToolCardClass | null
  surfaces: SessionSurfaceKind[] | null
  featureKey: string | null
  capabilityId: string | null
}

/** null result = the save normalized to "no override" (row deleted/absent). */
export function setToolPolicyOverride(
  db: Database,
  input: SetToolPolicyOverrideInput,
): ToolPolicyRow | null {
  const isAllInherit =
    input.enabled === null &&
    input.cardClass === null &&
    input.surfaces === null &&
    input.featureKey === null &&
    input.capabilityId === null

  return withTransaction(db, (tx) => {
    const existing = findToolPolicy(tx, { userId: input.userId, toolName: input.toolName })
    const now = new Date()
    let saved: ToolPolicyRow | null = null

    if (isAllInherit) {
      if (existing) deleteToolPolicy(tx, { userId: input.userId, toolName: input.toolName })
    } else if (existing) {
      saved = updateToolPolicy(tx, existing.id, input.userId, {
        enabled: input.enabled,
        cardClass: input.cardClass,
        surfacesJson: input.surfaces,
        featureKey: input.featureKey,
        capabilityId: input.capabilityId,
        updatedAt: now,
      })
      if (!saved) throw new Error('setToolPolicyOverride: update rejected by tenant filter')
    } else {
      saved = insertToolPolicy(tx, {
        id: randomUUID(),
        userId: input.userId,
        toolName: input.toolName,
        enabled: input.enabled,
        cardClass: input.cardClass,
        surfacesJson: input.surfaces,
        featureKey: input.featureKey,
        capabilityId: input.capabilityId,
        createdAt: now,
        updatedAt: now,
      })
    }

    const payload: ToolPolicyUpdatedPayload = {
      userId: input.userId,
      toolName: input.toolName,
      hasOverride: saved !== null,
      updatedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: TOOL_POLICY_UPDATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return saved
  })
}
