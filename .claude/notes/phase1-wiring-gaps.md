# Phase-1 wiring gaps — surfaced by the as-built doc pass (2026-07-14)

Findings the `.claude/docs/` documentation swarm turned up while reading the real code. Grouped by
theme, most load-bearing first. **✅ = I verified against the code directly this session; 📄 = a doc
worker reported it, not independently re-confirmed here** (still grounded in a file the worker read).

Nothing here is a fix that's been applied — this is a punch-list. See each module's `structure.md`
*Config & gotchas* for the in-context version.

---

## 1. The outbox is write-only — no dispatcher runs ✅

**Root cause of most "unwired consumer" notes.** Every feature correctly co-commits its lifecycle
events into `outbox_events` in one transaction (invariant #5 holds), but:

- `OUTBOX_CONSUMERS` in `packages/core/src/_shared/outbox-consumer-registry.ts` is the literal empty
  map `{}`.
- `dispatchOutboxEvents` has **no non-test caller** anywhere in `apps/`.

So every doc's *"Events published"* is real and every *"Events consumed"* is "none yet." Consumers
written **ahead of** the dispatcher — tested but dormant:

- `packages/memory` → `cleanupMemoryForChatSessionHardDeleted` (would consume `chat.session-hard-deleted`)
- `packages/channels` → `consumeScheduleRunCompletedEvent` (would consume `schedule.run-completed`)
- `packages/knowledge` → `handle-workspace-removed`

**To close:** register the consumers + start a dispatch loop (likely an in-process `local-api`
service, matching the other background ticks). This is a deliberate deferral, not a bug — but until
it lands, cross-feature reactions don't fire.

## 2. Whole leaves built-but-unwired ✅

Landed green + tested, but **no running turn imports them**:

- **`provider-preferences`** — only its own tests import it; no route, no session-runtime resolution.
  Effective provider is always the `DEFAULT_PROVIDER_ID` fallback (`'claude'`).
- ~~**`desktop-control`**~~ — RESOLVED: fully wired (boot creates the listener, both global-root
  composers list `desktopFeatureDescriptor`, `VYNEL_DESKTOP_ACT_ENABLED` is consumed in env.ts),
  and the per-app access-grant security model shipped on top (2026-08-04).

## 3. Background / purge jobs defined but not scheduled

The desktop runs no `apps/worker`; real ticks live in `local-api` services. These purge/maintenance
ops exist but **nothing calls them on the desktop**:

- `packages/files` → `FilesFileWatcherService` + `purgeOldFileActivities` 📄 — so `external`-editor
  audit rows are never recorded and old audit rows never purged.
- `packages/chat` → `purgeDeletedChatSessions` 📄 — no worker job wires it.
- `packages/approvals` → the two purge ops 📄 — exported, no timer.
- `packages/channels` → `purgeTerminalChannelRows` 📄 — no production caller.

(`memory` and `knowledge` maintenance/embedding ticks **do** run — via `local-api` services.)

## 4. Stale comments / module-notes behind the shipped code

Docs to reconcile so the next reader isn't misled (code wins in each case):

- `docs/module-notes/instructions-notebook.md` 📄 — says "PLANNED / not started"; the notebook half
  is fully shipped (leaf + migration 0005 + 6 routes + capability + MCP descriptor + UI).
- `docs/module-notes/cloud-admin-web.md` 📄 — says list-accounts "doesn't exist yet"; `GET
  /admin/accounts` + `/tier` + `/status` + the AccountsView controls all ship.
- `docs/module-notes/cloud-api.md` 📄 — says "nothing built (2026-07-10)"; auth + tiers + webhooks +
  catalog surface are all mounted.
- `docs/module-notes/orchestration.md` 📄 — references `run-root-delegation-turn.ts` under `leaf/`;
  the file is gone from `src/` (only a stale `dist/` artifact). Flagged by both orchestration workers.
- `docs/module-notes/marketplace-kinds.md` 📄 — claims `createAgent` inserts without co-committing
  an outbox event; the code now **does** co-commit `AGENT_CREATED` (fixed in `00d8bcd`). ✅
- In-code header comments now stale: `curated-agent-catalog.ts` (calls community install a
  "follow-up" though `installCloudAgent` ships) 📄, `marketplace-types.ts` ("owns no tables (D1)"
  vs the real cache table) 📄, `knowledge/schema/chunks.ts` + `knowledge/repositories/search.ts`
  headers 📄, `packages/embeddings` header ("real fp32 vector never generated" — resolved when the
  model moved to q8; Chad live-smoked a 384-dim embedding per STATE) 📄.

## 5. Minor code observations (low severity, mostly by-design)

- **`orchestration` delegate atomicity** ✅ — `delegate-to-leaf-session.ts` calls `recordLeafSession`
  (a chat-segment write) then `recordDelegation` (an outbox-event insert) as two **un-wrapped** calls,
  not one `db.transaction`. `recordDelegation` writes no state row of its own, so it's not a strict
  invariant #5 break — just a cross-call atomicity gap. Background-only; consumer unwired anyway.
- **`approvals` `file-delete` ActionKind is unreachable** ✅ — `deriveActionKind` never returns it
  (deletes go through Bash → `shell-command`, which still cards). Reads as a **reserved** enum for
  future providers per the code comment, not a bug. The card UI + `describe-approval-rule` do handle it.
- **`knowledge` global-scope documents unreachable via the detail route** 📄 — the single-doc route
  keys on `workspaceId`, so a global (`workspaceId = null`) document always 404s there. Latent.
- ~~**`marketplace` `PublisherTierSchema` allows `anthropic-official`**~~ ✅ CLOSED (2026-08-01,
  claude-official arc): the tier now flows hub→cache→item end-to-end; `isOfficial` covers both
  curated tiers.
- **`capabilities` has no desktop toggle UI** ✅ — only API/MCP toggling exists; the local-web tree
  has no capabilities panel or SDK call (only a prose mention in a marketplace card).

---
*Generated from the module-doc pass. Update or delete rows as they're closed.*
