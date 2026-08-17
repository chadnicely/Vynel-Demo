// `captureCompactionSummary` — the core op behind Layer 1 of continuity
// (ride auto-compaction; capture the SDK's `compact_summary` into durable
// memory). Given an SDK session that just compacted + its summary, it
// resolves the owning primary session and EMITS a `session.compacted` outbox
// event carrying the summary. The memory-write consumer is a FOLLOW-UP unit
// (cross-domain write = outbox, the locked pattern) — this op only emits.
// Spec: `docs/agent-base/session-continuity.md` "Core operations" + "The
// model" (Layer 1).
//
// No-op (returns null) when no live primary maps to the SDK session id — a
// compaction in a session Vynel isn't tracking as a primary carries nothing to
// fold. Logged, never thrown (a missing mapping is not an error).
//
// Determinate regardless of HOW the summary arrives: the PostCompact hook
// (providers) forwards `{ sdkSessionId, summary }` here through the
// chat-session bridge (the bridge mechanism is a flagged fork — see
// OVERNIGHT-STATUS). This op's signature does not depend on that choice.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import * as primarySessionsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { OutboxEventRow } from '@vynel/db/repositories/_shared'
import type { StructuralLogger } from './session-continuity-types.js'
import {
  SESSION_COMPACTED_EVENT_TYPE,
  type SessionCompactedEventPayload,
} from './session-continuity-events.js'

export type CaptureCompactionSummaryInput = {
  sdkSessionId: string
  summary: string
}

export async function captureCompactionSummary(
  db: Database,
  input: CaptureCompactionSummaryInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<OutboxEventRow | null> {
  const primary = primarySessionsRepository.findPrimarySessionByCurrentSdkSessionId(db, input.sdkSessionId)
  if (!primary) {
    deps.logger?.info(
      { sdkSessionId: input.sdkSessionId },
      'compaction in an untracked session — nothing to carry',
    )
    return null
  }

  const payload: SessionCompactedEventPayload = {
    primarySessionId: primary.id,
    sdkSessionId: input.sdkSessionId,
    userId: primary.userId,
    workspaceId: primary.workspaceId,
    summary: input.summary,
    capturedAt: new Date().toISOString(),
  }

  const event = insertOutboxEvent(db, {
    id: randomUUID(),
    type: SESSION_COMPACTED_EVENT_TYPE,
    payload,
    createdAt: new Date(),
    processedAt: null,
  })
  deps.logger?.info(
    { primarySessionId: primary.id, sdkSessionId: input.sdkSessionId, summaryLength: input.summary.length },
    'captured compaction summary -> session.compacted',
  )
  return event
}

/**
 * The per-session `onCompaction` dep every runner hands the provider — ONE
 * home for the Layer-1 hook so the global core, the routed runners and the
 * interactive turn all capture the same way (structural: matches
 * `StartChatSessionInput.onCompaction` without importing the provider type).
 * Best-effort inside: the provider's PostCompact hook already logs + never
 * throws, and a capture failure must never touch the live turn.
 */
export function buildCompactionCapture(
  db: Database,
  deps: { logger?: StructuralLogger } = {},
): (capture: CaptureCompactionSummaryInput) => Promise<void> {
  return async (capture) => {
    await captureCompactionSummary(db, capture, deps)
  }
}
