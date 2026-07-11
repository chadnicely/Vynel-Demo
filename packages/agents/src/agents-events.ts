// Outbox event type constants + payload interfaces for the
// `agents` domain — three lifecycle events: `agent.created`,
// `agent.updated`, `agent.deleted`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors the
// skills domain's `skills-events.ts`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future
// subscribers (sync, activity feed) need no producer-side migration.
//
// Install provenance lives in `agent.created`'s `source` field —
// `installCuratedAgent` / `installCloudAgent` delegate to
// `createAgent`, so the event is emitted exactly once where the
// transaction lives.

import type { AgentScope, AgentSource } from './agents-types.js'

export const AGENT_CREATED = 'agent.created' as const
export const AGENT_UPDATED = 'agent.updated' as const
export const AGENT_DELETED = 'agent.deleted' as const

export type AgentCreatedPayload = {
  agentId: string
  userId: string
  workspaceId: string | null // null = user-scope
  slug: string
  scope: AgentScope
  source: AgentSource
  createdAt: string
}

export type AgentUpdatedPayload = {
  agentId: string
  userId: string
  workspaceId: string | null
  slug: string
  scope: AgentScope
  updatedAt: string
}

export type AgentDeletedPayload = {
  agentId: string
  userId: string
  workspaceId: string | null
  slug: string
  scope: AgentScope
  deletedAt: string
}
