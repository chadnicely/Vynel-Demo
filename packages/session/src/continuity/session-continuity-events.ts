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
  // The continuing-session KIND (voice-continuity piece 1) — 'workspace' | 'global' |
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

// Emitted by `bridgePrimarySession` when a seed-fresh swap STARTS (before the
// distill) — the durable "patching context" signal a monitor can subscribe
// to; `session.swapped` follows when the fresh segment is live. Not a state
// change of its own (the primary repoints only at the end), so it is inserted
// on its own — a notification, not a co-committed transition.
export const SESSION_SWAPPING_EVENT_TYPE = 'session.swapping'
export type SessionSwappingEventPayload = {
  primarySessionId: string
  userId: string
  scope: PrimarySessionScope
  workspaceId: string | null
  // The session about to be superseded — the one the carry is distilled from.
  fromSdkSessionId: string
  // ISO timestamp of when the swap began.
  startedAt: string
}

// The swap did NOT land — the sibling every `session.swapping` gets when no
// `session.swapped` follows, so a monitor can tell "aborted" from "still
// swapping" instead of waiting on a start that never ends. Not a state change
// (the primary stays on its segment), so it is inserted on its own, like the
// start signal. `reason`: the carry was unusable (the distill returned nothing
// or a stub under the fidelity floor) or the swap threw (a seeding failure,
// a distill deadline).
export const SESSION_SWAP_ABORTED_EVENT_TYPE = 'session.swap-aborted'
export type SessionSwapAbortedReason = 'no-usable-carry' | 'failed'
export type SessionSwapAbortedEventPayload = {
  primarySessionId: string
  userId: string
  scope: PrimarySessionScope
  workspaceId: string | null
  fromSdkSessionId: string
  reason: SessionSwapAbortedReason
  // The thrown failure's message when `reason` is 'failed'; null otherwise.
  errorMessage: string | null
  // ISO timestamp of the abort.
  abortedAt: string
}
