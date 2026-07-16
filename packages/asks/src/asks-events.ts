// Outbox event type constants + payload interfaces for the `asks` domain —
// `ask.created` / `ask.resolved`, co-committed in the same sync
// `withTransaction` block as the state change (architecture invariant).
//
// `ask.created` carries the FIRST question's label + the count so the
// channels leaf can send a plain-language nudge ("Vynel needs your input:
// …") without importing this leaf — the schedule.run-completed delivery
// precedent. Answers NEVER enter a payload (they may hold anything the user
// typed).

import type { AskRequestStatus } from './repositories/index.js'

export const ASK_CREATED = 'ask.created' as const
export const ASK_RESOLVED = 'ask.resolved' as const

export type AskCreatedPayload = {
  askId: string
  userId: string
  workspaceId: string | null // null = a global-root turn's ask
  questionCount: number
  firstQuestionLabel: string
  createdAt: string
}

export type AskResolvedPayload = {
  askId: string
  userId: string
  workspaceId: string | null
  status: Exclude<AskRequestStatus, 'pending'>
  resolvedAt: string
}
