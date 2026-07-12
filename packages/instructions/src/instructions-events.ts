// Outbox event type constants + payload interfaces for the `instructions`
// domain — three lifecycle events: `instruction.created`,
// `instruction.updated`, `instruction.deleted`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors the agents
// domain's `agents-events.ts`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future
// subscribers (sync, activity feed) need no producer-side migration.
// Payloads carry LOOSE REFS + scalars only — never the document body.

import type { InstructionScope, InstructionMode } from './schema/instruction-documents.js'

export const INSTRUCTION_CREATED = 'instruction.created' as const
export const INSTRUCTION_UPDATED = 'instruction.updated' as const
export const INSTRUCTION_DELETED = 'instruction.deleted' as const

export type InstructionCreatedPayload = {
  documentId: string
  userId: string
  scope: InstructionScope
  workspaceId: string | null // null = global scope
  mode: InstructionMode
  createdAt: string
}

export type InstructionUpdatedPayload = {
  documentId: string
  userId: string
  scope: InstructionScope
  workspaceId: string | null
  mode: InstructionMode
  updatedFields: string[]
  updatedAt: string
}

export type InstructionDeletedPayload = {
  documentId: string
  userId: string
  scope: InstructionScope
  workspaceId: string | null
  mode: InstructionMode
  deletedAt: string
}
