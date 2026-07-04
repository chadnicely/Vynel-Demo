# channels vertical-slice + decouple — `@vynel/channels` (2026-07-04)

Chad's priority feature #1. First COUPLED leaf — required real decoupling (not a faithful move) to
satisfy invariant #2. Advisor-vetted, precedent-anchored (orchestration: inject ops in leaf, defer
the poll-tick runner to app-wiring).

## What landed
New leaf `@vynel/channels` owning channels schema (channels + 3 child tables) + repos + logic, folded
memory-style: `schema/`·`repositories/`·`lifecycle/`·`senders/`·`queries/`·`inbound/`·`delivery/`·
`adapters/` (incl. telegram). Schema+repos git-mv'd from kernel; logic from source `core/src/channels`.

## Decoupling (the non-faithful part — deliberate, behavior-preserving)
- **`resolveApproval`** (route-as-approval-reply) — was `import from '@vynel/core/approvals'` + `vi.mock`.
  Now INJECTED via `ProcessInboundDeps` (typed STRUCTURALLY, like the pre-existing `runRootTurn`),
  threaded through `process-inbound-message`. Test converted `vi.mock` → `vi.fn()` fake via `deps`;
  **every assertion unchanged** (reviewer confirmed no weakening).
- **`ChatTurnEvent`** (3 delivery files) — rewired `@vynel/core/chat` → `@vynel/contracts/chat/chat-http`
  (the shared WIRE variant). Verified the 3 consumers read only string fields (session.id, textDelta,
  errorMessage, toolName, toolInput, approvalRequestId) — **no Date/string latent bug** (reviewer read
  all 3 + confirmed the consumer set is exhaustive). NO `@vynel/chat` dep added.
- `@vynel/core/errors` → `@vynel/errors`; a test's chat-repo dep → contracts fixture.
- **Deferred to app-wiring** (orchestration precedent): `run-channel-polling-tick` +
  `run-channel-delivery-tick` (worker-cron composition bodies that provide the real injected deps).

## Forward-notes for the deferred app-wiring
1. Injected `resolveApproval` structural type carries `workspaceId` (real KLONE resolve is user-scoped)
   → trivial adapter cast at wiring. Documented in channels-types WHY.
2. `createChannelEventTranslator` now types its param as the contracts (string-timestamp) `ChatTurnEvent`;
   the real runtime stream emits `@vynel/chat`'s Date-timestamp event → a cast at the polling tick.
   Runtime-safe (translate reads only session.id). Accepted cost of the contracts choice.
3. Barrel omits `deriveIntentKind`/`createChannelEventTranslator`/`resolveChannelAdapter` (faithful —
   in-module to the deferred ticks); add when the ticks land.

## Gate
- drizzle **"No schema changes"** (schema move behavior-neutral, 4 tables). Full `pnpm test` **1380 passed
  / 4 skip** (channels 82). typecheck 52/52. parity 30. Zero sibling-leaf runtime import (grep-proven).
- `code-reviewer`: CLEAN, zero must-fix. `botCredentials` opaque + scrubbed in error paths (extract-error-message).

## Deferred improves (mission-wide)
Stale kernel-location doc-comments in `repositories/{channels,index}.ts` + `schema/index.ts` (name the
old `@vynel/db/...` home). Comment-only; sweep in an improve pass. **Next: workspaceId-nullable scope
improve, then the channels CRUD API.**

## scope-improve + API vertical — DONE
- **Scope improve** (`c3bc071`): `channels.workspaceId` nullable (null=global), baseline-folded
  (`id()`→`text()`, baseline SQL + snapshot `notNull:false`), `connectChannel` accepts `string|null`.
  drizzle "No schema changes"; migrate-baseline green. Reviewer confirmed approvals-precedent-correct.
- **API port**: 9 routes (source `apps/api/src/routes/channels`, workspace-scoped) → `apps/local-api`.
  SDK `client.channels.*` (9); MCP 2 read tools (list_channels, list_allowed_senders) — NO mutating/
  credential route exposed (connect carries the bot token → SDK-only). Serializer OMITS botCredentials +
  lastPolledCursor (TS-enforced); credential-leak test seeds non-null cursor + asserts undefined.
  `ChannelResponse.workspaceId`→`string|null` (matches column). Gate **1389**; reviewer CLEAN.
- **Deferred**: global-channel CREATION via API (schema+op ready; workspace-scoped routes are the faithful
  port — a user-scoped `/channels` connect is a follow-up for Chad). disconnect null-workspace path (fwd-note).
  Serializer asymmetry (allowed-senders/history raw rows — no credential surface).
