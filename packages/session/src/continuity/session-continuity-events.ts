// Outbox event types the `session-continuity` domain PUBLISHES. Per
// `.claude/rules/structure-standard.md` "packages/core/src/"
// (`<domain>-events.ts`) + data-standard "Cross-domain communication"
// (outward only via the outbox).
//
// `session.compacted` is the durable-carry SIGNAL: when the SDK compacts a
// primary session, the captured `compact_summary` is emitted as this event so
// a downstream consumer (the memory-write — a FOLLOW-UP unit) can fold it
// into the visible-memory index. This domain only EMITS; it does not
// consume.

import type { PrimarySessionScope } from '../repositories/index.js'

// The event-type string stored in `outbox_events.type`.
export const SESSION_COMPACTED_EVENT_TYPE = 'session.compacted'

export type SessionCompactedEventPayload = {
  primarySessionId: string
  // The SDK session id that compacted (the primary's current session).
  sdkSessionId: string
  userId: string
  // NULL for the global primary (Slice 3b) — it has no workspace. Non-null for a
  // workspace primary. The monitor narrows the payload client-side.
  workspaceId: string | null
  // The SDK's own compaction summary (`PostCompactHookInput.compact_summary`).
  summary: string
  // ISO timestamp of when the compaction was captured.
  capturedAt: string
}

// The event-type string stored in `outbox_events.type`. Emitted by
// `bridgePrimarySession` after a Layer-2 seed-fresh SWAP — the primary repointed
// from one SDK session to a fresh one (the future monitor surfaces it; the
// user sees nothing). Distinct from `session.compacted` (Layer-1 capture).
export const SESSION_SWAPPED_EVENT_TYPE = 'session.swapped'

export type SessionSwappedEventPayload = {
  primarySessionId: string
  userId: string
  // The continuing-session KIND (voice-jarvis piece 1) — 'workspace' | 'global' |
  // 'voice'. Lets the monitor attribute a swap to any kind, not just primaries.
  scope: PrimarySessionScope
  // NULL for the global primary (Slice 3b) + the voice session — neither has a
  // workspace. Non-null for a workspace primary. The monitor narrows client-side.
  workspaceId: string | null
  // The session the primary was swapped AWAY from (recorded as superseded).
  fromSdkSessionId: string
  // The fresh seeded session the primary now points at.
  toSdkSessionId: string
  // ISO timestamp of the swap.
  swappedAt: string
}
