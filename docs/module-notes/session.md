# Module note — `@vynel/session` (the keystone)

*Slice 1 landed 2026-07-04 — the continuity foundation + the `root → primary` rename, green
(`pnpm test` EXIT 0: typecheck · parity 30 · vitest 1162) + drizzle "No schema changes". The session
domain: parent of chat; the turn service that returns a stream or a response.*

## The reframing (why the keystone is smaller than STATE assumed)

STATE framed `@vynel/session` as a grand unifier of a 28-file `apps/api/src/sessions/` spread. The source's
own owner-approved docs (`.claude/ceo/restructure/{b-lead-session-library-design,session-migration-plan}.md`)
say otherwise:
- The hard refactor was **already done** in the source branch (B0–B2b: the `SessionSink` abstraction, the
  global-root SSE/drain twin collapsed onto one sink-parameterized core, the global-root runner relocated
  into `@vynel/session/runtime`).
- The **"one generic `runSessionTurn` for all scopes" goal was dropped** as wrong-shaped: the runners share
  only a ~10-line loop, and the workspace runner (`start-chat-turn`) + leaf runner (`drainLeafTurn`) belong
  to their domains. Only the **global-root runner was homeless** → that's the one that went to session.

So the KLONE pull is a **faithful move of already-refactored, scope-specific code**, not a fresh unification.

## The architecture decision (owner-confirmed) — continuity ∈ session, cycle-free

`@vynel/session` is the **parent of chat** and the turn service: *any package calls session and gets back a
stream (SSE sink) or a response (drain sink)*. The layering:

```
 apps (api/worker/cli) ─────► call session → stream | response
 schedules · channels ──(outbox / injected dep)──► trigger a turn (never import the runner up)
                              │
                              ▼
       @vynel/session  ── OWNS: continuity (primary_sessions) + runners (global-root, workspace,
                          seeded-swap, delegation) + composers + resolvers
                              ▼  (down-only; no reverse edges)
   @vynel/chat (persist, continuity-FREE)   @vynel/orchestration (delegation; turn-runner injected)
                              ▼
              @vynel/providers · @vynel/db · capabilities · memory · agents
```

- **Continuity ∈ session is cycle-free** because every continuity importer is either session-tier (lands in
  `@vynel/session`) or an app (above it). Verified: `@vynel/chat` and `@vynel/orchestration` are
  continuity-FREE. This holds **because** the chat pull excluded `start-chat-turn` (it goes to session) —
  the two decisions are mutually reinforcing.
- **Monitor was cut by the owner** ("skip the monitor entirely"). Monitor was the ONE thing that would have
  forced continuity below session (it reads continuity + would create `session → monitor → continuity →
  session`). Gone → continuity ∈ session is clean.
- The migration plan kept continuity in `@vynel/core` (a shared domain) — but that was driven by a
  `core ↔ session` **cycle that only exists in the monolith**. KLONE's decomposition removes it
  (`session → chat` is clean one-directional), so continuity ∈ session is the better-founded shape here.
- **Turn-invocation decoupling (forward commitment):** when `schedules`/`channels` land, their turn-firing
  must decouple from the runner (outbox event OR an injected `runTurn` dep — the `delegate-to-workspace-root`
  DI precedent), never a direct import (invariant #2). This is why the runner's home isn't constrained by
  those features.

## Slice 1 as-built (the continuity foundation)

- **Vertical-slice:** git-mv'd `primary_sessions` (was `root_sessions`) schema+repos from the kernel into
  `packages/session/src/{schema,repositories}`; pulled the 13-file continuity logic from old
  `packages/core/src/session-continuity/` into `src/continuity/` (preserving `internal/filesystem-session-store`).
  Only rewire: `@vynel/db/repositories/session-continuity → ../repositories/index.js` + hub FKs. Diff-verified
  byte-faithful before the rename.
- **The `root → primary` rename (Slice 1b):** renamed the durable-session-identity concept ONLY — table,
  `PrimarySession*` types, `find/getOrCreate/link/bridge/list-Primary*` functions + files + index names. The
  filesystem store's `rootDir` / "root directory" is deliberately UNTOUCHED (a filesystem root, not the
  identity). **Migration folded into the baseline** (owner's call: pre-release, zero data → edit
  `0000_baseline.sql` + `meta/0000_snapshot.json` to define `primary_sessions` directly, no rename migration).
  Verified by "No schema changes".
- **Barrel (3-surface split done in Slice 2a):** `.` = the WEB-SAFE `session-mode` model; `./runtime` = the
  runners + `SessionSink` (pulls db/providers); `./continuity` = the identity/swap machinery. Constraint #1
  satisfied — `apps/web` can import the barrel without dragging db/providers into its bundle.

## Deferred / tracked

- **Layer-B vocabulary ripple:** the cross-package *active fields* `globalRootSessionId` (chat
  `record-pushed-report-message`) + `rootSessionId` (contracts `chat-http`) stay as loose-ref strings; they
  rename for consistency when chat's session-integration + the HTTP surface are pulled. (Stale *comment*
  citations of the renamed symbols were swept now.)
- **Doc vocab drift (later sweep):** `docs/architecture.md §5` ("a stable `rootSessionId`") + `docs/scaffold.md`
  (the `session-continuity/root-sessions.ts` tree entry) still use the old vocab. A coherent docs vocab sweep
  lands with the Slice-2/3 surfaces — not piecemeal in the code-move commits.
- **Improve (Slice-2a reviewer) — fold `collect`+`mark` into one orchestration op.** The global-root catch-up
  currently calls two barrel exports (`collectDelegationReportsForRoot` read + `markDelegationsSurfacedToRoot`
  write). A later `surfaceDelegationReportsForRoot` op inside `@vynel/orchestration` would keep the raw repo
  write private + expose one intention-revealing operation, preserving the deliberate mark-before-turn
  exactly-once semantics. NOT inject-as-dep (wrong direction for a compose-layer module that legitimately
  imports the leaf for the read-half).
- **Invariant #8 — non-emitting continuity writes are intentional (reviewer-confirmed).**
  `linkPrimarySessionToSdkSession` + the insert in `getOrCreateContinuingSession` mutate `primary_sessions`
  WITHOUT an outbox event — faithful + deliberate: only compaction/swap are cross-domain events
  (`session.compacted`/`session.swapped`); initial-link + identity-create are not consumed elsewhere, so no
  event is owed.
- **Slice 2a — DONE (COMMIT PENDING):** the global-root runner CORE (`run-global-root-turn-core` + `SessionSink`
  in `session-types` + `root-turn-lock` + `global-root-instructions`) + `session-mode` + the 3-surface barrel
  split. Exposed `markDelegationsSurfacedToRoot` from the `@vynel/orchestration` barrel (the write-back half of
  the Ch3.5 catch-up, paired with the already-public `collectDelegationReportsForRoot`). Applied the Slice-1
  primary rename to the runner (`primarySessionId`, `linkPrimarySessionToSdkSession`). Deps +chat/orchestration/providers.
- **Slice 2b — NEXT: the workspace runner + resolvers/composers.** `start-chat-turn` (workspace) + seeded-swap +
  Hono-free resolvers (`resolve-*-conversation`) + composers (`compose-session-{capabilities,mcp-servers}`) +
  continuity-application (`apply-root-turn-continuity`, `bridge-root-session-after-turn`, `run-seeded-swap-session`).
  Deps expand to capabilities, memory. **Decision at 2b:** may `@vynel/session` dep the MCP producers
  (`@vynel/mcp`+`@vynel/desktop-control`) for `compose-session-mcp-servers`, or does MCP composition stay at the
  app edge? (`api-side-turn-execution-with-mcp`).
- **Slice 3 — app wiring + the SSE sinks** (when `apps/api` lands): `streams/{chat-turn,global-root-turn}`
  (Hono glue), the `delegate-to-*` compositions, `run-delegation-claim-and-run-tick`, `wrapAppRequestWithOrigin`.
- **The b-lead owner-forks (later, not blockers):** event-vocabulary unification (workspace `ChatTurnEvent`
  vs global-root `NormalizedSessionEvent`) — a UI-domain product call; approval routing Fork 2
  (`interactive` + `auto-deny` now, `surface-up` as a seam) — the real approval card. Both preserve the
  additive invariant (both SSE endpoints byte-for-byte); ship faithfully, improve later.

## Precedent set

**Pre-release schema changes fold into the `0000` baseline** (owner's call) rather than accrue incremental
migrations — valid while zero data / zero deployments exist. Incremental migrations resume once there's a
deployed schema to preserve.
