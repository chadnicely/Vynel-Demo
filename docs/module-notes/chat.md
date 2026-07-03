# Module note — `chat` (persistence engine + history)

*Landed 2026-07-04 — vertical-slice + concern-fold, green (`pnpm test` EXIT 0: typecheck 41 · parity 30 ·
vitest 1091) + code-reviewed (commit-ready, no blockers). The first substrate pull beneath `@vynel/session`.*

## What chat is

The **turn-consumption + persistence layer**: it drains a provider's normalized event stream, persists
messages / tool-calls / usage, and serves the chat-history reads. It is **pure persistence** — it does
NOT run turns. The runners (which *drive* `consumeSessionEventStream`) live in `@vynel/session`.

## Chad's decisions (the advice this pull satisfies)

1. **Pure persistence — the runner is excluded.** `start-chat-turn.ts` (+ its test) is the workspace
   turn-*runner*, misfiled in `chat/`. It is the ONLY chat file that touches `session-continuity`. It is
   **not pulled here** — it lands later with `@vynel/session`, unifying the workspace + global-root
   runners under §5's one primitive. Excluding it makes chat continuity-free → no `session ⇄ chat` cycle.
2. **`primary` vocabulary — deferred to the session pull.** Chad's call: rename the durable session
   concept `root` → `primary` (a *workspace root* is confusingly both a "root" and a delegated child of
   the *global root*; "primary session per scope" + parent/child edges is cleaner). Chat carries a few
   `root` refs (e.g. `record-delegated-root-messages`, comments). **Keep them faithful in this pull**;
   the sweep lands with continuity/session where `primary_sessions` actually lives — one coherent move,
   no shim.
3. **Chat owes an MCP-readable context surface.** The seed already exists: `get-session-context-report.ts`.
   A post-swap session must be able to *read its own prior context through an MCP tool* (not only via a
   stuffed seed message). Chat's reads (`get-session-context-report`, `get-chat-session-detail`,
   `search-chat-sessions`) back a future `McpFeatureDescriptor` attached to the session turn. **Design the
   read surface with this in mind; land the descriptor at the session pull** (alongside memory + knowledge,
   which also owe descriptors).
4. **Pull whole, as a vertical-slice.** Persistence + history CRUD together (don't split the domain).
   Own `schema/` + `repositories/` + logic in `packages/chat/`, knowledge-style folders.

## The mapped shape (old repo `refactor/session-library`)

- **Logic** `packages/core/src/chat/` — 27 non-test + ~22 tests. By concern:
  - *turn-consumption:* `consume-session-event-stream` (+ `-approvals`/`-session`/`-chunks-tools` tests +
    `-test-helpers`), `handle-session-started`, `handle-usage-reported`, `handle-approval-requested`,
    `ensure-assistant-message-row`, `attached-images`, `chat-turn-event`
  - *records* (pure chat writes, called by session's delegate layer): `build-new-chat-session-row`,
    `record-swap-segment-session`, `record-leaf-session`, `record-delegated-root-messages`,
    `record-pushed-report-message`, `compose-manager-source-label`
  - *history:* `list-chat-sessions-for-workspace`, `get-chat-session-detail`, `search-chat-sessions`,
    `rename-chat-session`, `archive-chat-session`, `soft-delete-chat-session`, `interrupt-chat-session`,
    `purge-deleted-chat-sessions`, `synchronize-chat-sessions-for-workspace`, `generate-session-title`
  - *context (MCP seed):* `get-session-context-report`
  - *shared:* `chat-types`, `chat-events`, `index`
  - **EXCLUDED:** `start-chat-turn` (+ test) → `@vynel/session`
- **Schema** `packages/db/src/schema/chat/` — `chat-sessions`, `chat-messages`, `chat-tool-calls` (3 tables)
- **Repos** `packages/db/src/repositories/chat/` — `chat-sessions`, `chat-messages`, `chat-tool-calls`,
  `chat-search` (+ tests)

## Dependency check — self-contained, one deferred cross-feature edge ✅

Chat imports: `@vynel/db` · `@vynel/db/{schema,repositories}` · `@vynel/providers` · `@vynel/logger` ·
`@vynel/errors` · **`@vynel/approvals`** (lazy `await import` in `turn-consumption/handle-approval-requested.ts`
— the one cross-feature edge, see below). Tests seed via `@vynel/db/repositories/{users,workspaces}` +
`@vynel/testing`. No orchestration, no continuity (the runner is out) — cycle-free.

**Deferred cross-feature seam (invariant #2):** the turn engine records an approval request by calling
`@vynel/approvals`'s `recordApprovalRequest` synchronously (the stream needs the approval id to emit its
event). Landed faithfully; there is NO injection point in KLONE today (the only caller, `start-chat-turn`, is
excluded), so "fix now" would be strictly worse. **Decouple when `@vynel/session` lands** (injected dep or
outbox). Confirmed one-directional — approvals does not import chat, no cycle. Code-review agreed: land + defer.

## The pull plan

Vertical-slice into `packages/chat/{schema,repositories,+foldered-logic}` (mirror the blessed `memory`
template `9213dfe`): git-mv logic+tests+schema+repos, exclude the runner, rewire `@vynel/core/errors` →
`@vynel/errors` + internal relative imports, fold into concern-folders. **Prove neutral:** `drizzle-kit
generate` → "No schema changes" + full gate green (typecheck + parity + vitest). Then `code-reviewer` →
prompt Chad to commit.

## Known gaps / deferred improves (do NOT slip in on red)

- `root` → `primary` vocabulary sweep — **with the session/continuity pull** (where `primary_sessions` lands).
- Chat's `McpFeatureDescriptor` (the MCP-readable context surface) — **with the session pull**.
- Check `consume-session-event-stream.ts` size vs the ~300-line rule; split by handler if over.
- KLONE has **zero chat consumers** today (session/channels/schedules not yet pulled) → chat lands as pure
  foundation; the rewire surface is internal-only.
