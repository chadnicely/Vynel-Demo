// Shared helpers for the `consume-session-event-stream.*.test.ts` siblings.
// Extracted at ship time per code-reviewer Gate 3 finding C3 (the original
// test file exceeded the 300-line cap; split into 3 sibling test files —
// session / chunks-and-tools / approvals-and-happy-path).
//
// Filename intentionally lacks the `.test.ts` suffix so vitest's default
// glob doesn't pick it up as a test file.

import { randomUUID } from 'node:crypto'
import type { NormalizedSessionEvent, AiAgentProviderId } from '@vynel/providers'
import type { NewChatSession } from '../repositories/index.js'
import type { UserMessageInput } from './consume-session-event-stream.js'
import type { ChatTurnEvent } from '../chat-turn-event.js'

export const PROVIDER_ID: AiAgentProviderId = 'claude'

export function makeUser() {
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'WS',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

export function makeExistingSession(
  userId: string,
  workspaceId: string,
  id: string,
): NewChatSession {
  const now = new Date()
  return {
    id,
    userId,
    workspaceId,
    providerId: PROVIDER_ID,
    title: 'Existing',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  }
}

export function makeUserMessageInput(body: string = 'Hello'): UserMessageInput {
  return {
    id: randomUUID(),
    body,
    attachedImagesMetadata: null,
  }
}

export async function* eventsFrom(
  events: NormalizedSessionEvent[],
): AsyncIterable<NormalizedSessionEvent> {
  for (const event of events) yield event
}

export async function drain(iter: AsyncIterable<ChatTurnEvent>): Promise<ChatTurnEvent[]> {
  const out: ChatTurnEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}
