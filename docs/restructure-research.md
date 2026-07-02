# Vynel — Restructure Research & Context

**Created:** 2026-07-02 · **For:** Chad · **Status:** research synthesis, awaiting the which-repo decision
**Old repo:** `E:\KAFI\WORKSPACE\v2\vynel` · **This dir:** `E:\KLONE\Workspace\vynel` (fresh/empty)

> Purpose: build the context for how we shape Vynel "so it never breaks and stays reusable,"
> grounded in what already exists. **No code moves until you pick a path (§9).**

---

## 0. TL;DR

- The old repo is **not a mess to escape** — it's a **healthy, near-complete product** (all 15 Phase-1 domains shipped, clean dependency DAG, no rot) that **outgrew its catalog in exactly one place**: the agent-base / session wiring.
- The "installable-library + MCP-everywhere + one-brain-session" shape you're describing **is already an owner-approved plan you signed off on 2026-06-27** — the *modular monolith* — and it is **~40% executed on an unpushed branch** (`refactor/foundation`, 14 commits, 2176 tests green).
- **The stack is modern and correct. Keep it.** No rewrite.
- The real decision is **which repo we continue in** (§9), not whether to reuse the code.
- **Step zero, whatever we pick: the `refactor/foundation` branch is unpushed and local-only. Back it up first.** (Your own "never lose it" principle, applied to the code.)

---

## 1. What the old repo actually is

A **pnpm + Turborepo monorepo**, TypeScript strict/ESM, that wraps Claude Code via
`@anthropic-ai/claude-agent-sdk@0.3.181` behind an `AiAgentProvider` abstraction.

**Shipped (Phase 1, all 15 domains `shipped`):** users, workspaces, providers, chat, approvals,
memory, knowledge, skills, marketplace, channels (Telegram), schedules, onboarding, **mcp**, files,
capabilities. Plus the agent-base "brain-tree": session-continuity (shipped), global-root routing
(shipped), agents + orchestration (building), monitor (draft).

**Health verdict** (from a prior 8-agent + adversarial-verify research run, 1.34M tokens):
> "Structurally healthy… no rot, no tangle, no cross-package boundary violation. A tidy codebase
> that outgrew its own catalog in one area, not an OpenClaw situation."

- `packages/core`: 16.3k lines / 21 subfolders but a **clean shallow DAG** — 19 cross-core edges,
  max inbound degree 2, no cycles.
- The data layer is the **most** restructure-ready part (folder-per-domain schema + repos already).
- **The strain is localized** to the agent-base wiring: organized by *transport*
  (`routes/streams/services/` + a 29-file `apps/local-api/src/sessions/`) instead of by feature, with
  **no single "run a root turn" primitive** (reimplemented 4-5×). That's the sprawl you're feeling.

---

## 2. The target shape — modular monolith ("never breaks / reusable")

The decisive gate was **the database**, and it's settled:

- **Physical per-feature DBs = NOT FEASIBLE.** Kernel foreign keys (`users` ×17, `workspaces` ×14,
  all `onDelete: cascade`, enforced at the connection level) + same-transaction outbox atomicity
  (every state change co-commits its outbox event in one `db.transaction`) both require one DB file.
  Splitting = a microservices rebuild = breaking the working product.
- **Logical per-feature ownership behind ONE shared `@vynel/db` = FEASIBLE**, and the DB is already
  substantially that shape — **every cross-feature FK is intra-domain**; features loose-ref each
  other through the outbox, never FK into each other.

**The shape:**

```
KERNEL (small, stable, every feature imports it):
   users · workspaces · _shared/outbox · dialect · client/migrate/transactions

LEAVES (clean, low-coupling → become @vynel/<feature> packages over time):
   voice · knowledge · files · memory · capabilities · marketplace · agents · approvals
   (already standalone, zero DB tables: desktop-control · embeddings · indexer · providers)

SPINE (stays in core + app-composition — do NOT library-ize):
   chat (turn hub) · users/workspaces · orchestration/session-continuity · onboarding

COMPOSITION LAYER (the real reshape → Track B):
   the transport-organized routes/streams/services/sessions  →  a "brain"/session library
   with ONE parametric Session primitive (scope · tool-set · sink)
```

"Installable library" here = **internal `@vynel/<feature>` workspace package over the shared kernel**
(feasible now). Literally `pnpm install`-able by a third party = north-star only (needs the kernel-FK
problem solved) — don't design for it yet.

---

## 3. Your "Session" vision → what's already built

| Your words | Reality |
|---|---|
| Root limitless continuous session, **renewed before compact** with old context | **`session-continuity` — SHIPPED & live-validated.** Stable `rootSessionId` → swappable SDK session; at context pressure it distills → seeds a fresh session → repoints the root, invisibly (`bridgeRootSession`). |
| **Global Root** — primary, all channels, routes to workspace/spawn session/agent | **SHIPPED at the backend.** `POST /api/root/turn` + `GET /api/root/continuing` + a `/routing/*` layer. The `/global` chat UI is in progress. |
| **Workspace root** — durable long context, reports to global | The per-workspace continuity root (shipped). |
| Agents as "hands," children report to parent | `agents` (building) over the SDK `AgentDefinition`; `monitor` tree (draft) = "see what the hands are doing." |
| Everything unified | **Track B owner directive (yours, 2026-06-28): "everything is a session"** — one unified Session library (global / workspace-root / agent-task) with realtime streaming + background + tracking built-in. **GATED, not started.** |

So the hierarchy you described is **largely built**; the missing piece is the *unification* (Track B).

---

## 4. Tech stack verdict — keep it

| Layer | Choice | Verdict |
|---|---|---|
| Runtime / lang | Node 22 LTS · TS ^5.4 strict · ESM | ✅ keep |
| HTTP | Hono v4 (typed RPC, OpenAPI from Zod) | ✅ keep — great for a local daemon |
| ORM / DB | Drizzle · better-sqlite3 (P1) → Postgres 16 (P2), dialect-agnostic | ✅ keep |
| Realtime | SSE + in-process pub/sub (P1) → Redis (P2) | ✅ keep |
| Frontend | Vue 3 + Vite + Pinia + Tailwind 4 | ✅ keep (matches your stack) |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` behind `AiAgentProvider` | ✅ keep — the whole multi-runtime story rides this seam |
| Monorepo | pnpm + Turborepo, generators (OpenAPI→SDK→MCP) + parity checks | ✅ keep |
| Models | Default `claude-opus-4-8` (Opus 4.8, 1M ctx, $5/$25). Sonnet 5 for volume, Haiku 4.5 for cheap/fast. | ✅ current |

**One locked decision worth re-opening:** desktop packaging is locked to **Tauri** (foundation §14;
`apps/desktop/src-tauri` exists). Your own stack is **Electron**. For an always-on "Jarvis" voice
daemon + local API, Electron's Node main process hosts the API/session runtime in-process with no
sidecar dance; Tauri needs a Node sidecar subprocess. Trade-off: Tauri = tiny native binary; Electron
= heavier but simpler lifecycle + you know it. Not the headline — flag for a deliberate call.

---

## 5. Surfaces: desktop app + local API + CLI (how to process a "desktop request")

The answer is the **layered core**: one shared brain, thin surfaces on top.

```
        packages/core + kernel @vynel/db + @vynel/providers   ← the brain (one home for logic)
                 ▲              ▲               ▲
   apps/local-api (Hono daemon)   apps/desktop     apps/cli (NEW)
   local HTTP + SSE         (UI shell)       thin client over @vynel/sdk
                 ▲              ▲               ▲
                 └──────── all call the SAME core ─────────┘
```

- **Local API (Hono)** is the daemon — the "brain process." Desktop and CLI are clients of it (or
  embed it). Every capability is one core operation; route/CLI/worker are thin callers.
- **A "desktop request"** (mouse/keyboard/screen control) flows through the **`desktop-control` MCP
  server attached to the session** — not a bespoke path. That attachment is now unified (§6).
- **CLI** = a thin surface over the generated `@vynel/sdk` (same typed client the web app uses).
  This is a **genuinely new surface to build** — see §7.
- **Reality today:** `apps/desktop` is a *minimal Tauri v2 voice-overlay widget* (a 420×160 floating
  status dot + tray driving the voice sidecar) — **not** the full desktop app yet. The real UI is
  `apps/web` (Vue). The "desktop application" to build = the shell hosting `apps/web` + the voice
  overlay + the local API daemon. **This is what makes the Tauri-vs-Electron call (§4) concrete.**

---

## 6. MCP everywhere — largely solved (Track A, C4 — DONE)

Your ask: "all MCP exposed in api, cli, attached to agent SDK." The unified seam already shipped on
the branch:

```
@vynel/mcp-contract  (McpFeatureDescriptor: {serverName, build(ctx), toolNamePrefix,
                       mutatingToolNames[], gatedByCapability?, promptContribution?})
        ▲                         ▲
  apps/mcp (vynel* route-derived)   @vynel/desktop-control (desktop)
        └────────► composeSessionMcpServers()  ◄────────┘   (3rd sibling of composeSessionCapabilities/Agents)
                          │
             ALL 5 turn paths (agent SDK) + apps/mcp external HTTP adapter (external clients)
```

- A new feature ships a **descriptor** and plugs into every entry point with **no per-entry-point
  edits**. That's the "easy per-feature MCP attachment" you wanted.
- Bonus already wired: destructive tools auto-card via `mutatingToolNames` →
  `TOOLS_ALWAYS_REQUIRING_APPROVAL`; the desktop-by-channel divergence bug is closed.
- **Remaining MCP work:** the **CLI** as a fourth consumer (rides `@vynel/sdk`), and the external
  HTTP transport binding (deferred to first consumer).

---

## 7. Genuine gaps (net-new — not yet built or planned)

1. **User-facing `vynel` CLI** — a real new surface. *(Note: the branch's "C5 CLI-readiness" is a
   different thing — it's about spawning **other** AI runtimes, Codex/Gemini/Cursor, as
   `AiAgentProvider`s. Not a CLI for the user to drive Vynel.)*
2. **Cloud marketplace backend** (authenticated API serving agents/skills/rules/mcps/plugins) —
   Phase 2, not started. Today's marketplace is a thin local annotation over the bundled skill.
3. **Memory backup / restore** ("never lose after reset or reinstall") — genuine gap. Memory is local
   SQLite; cloud sync is deferred to Phase 2. A local export/restore (and later cloud backup) is net-new.
4. **Voice / Jarvis — already built and working** (not a gap to *build* — a thing to *harden +
   consolidate*). `apps/voice` is a complete always-on loop: wake-word → Whisper STT → Kokoro TTS →
   `/root/turn` → speak, with fast/balanced/accurate quality modes, driven by the Tauri tray. Missing:
   unit tests, and consolidating its 6 scattered surfaces into `@vynel/voice` (Track B).

---

## 8. Branch state (as of the old repo's resume snapshot, 2026-06-28)

Branch **`refactor/foundation`** — 14 commits, all `pnpm test`-green (**2176 tests**),
`code-reviewer`-clean, **nothing pushed**.

- **Track A DONE:** C1 safe cleanups · C2 agent-base cataloged · C4 unified MCP-attach seam (5 units).
- **Deferred (per your directive):** C3 instructions-home **UI**, C5 CLI-readiness (forward-looking).
- **Track B GATED** (awaits your go): the brain/session library ("everything is a session") +
  leaf-by-leaf feature packaging, pilot = `@vynel/knowledge`.

---

## 9. The decision — which repo do we continue in?

Rewrite-from-scratch is **off the table** (2176 green tests + a working product + the OpenClaw
precedent). The live choice is:

- **A. Continue in-place on `refactor/foundation` (KAFI).** Fastest, keeps the branch and history,
  zero migration. Cost: stays in the repo you associate with the sprawl.
- **B. Seed this repo (KLONE) from the `refactor/foundation` branch, then continue Track B here.**
  Clean top-level shape + clean git history from day one, **reusing** the tested code + the Track-A
  work. Likely what "build the project here / reuse the tested code" means. Cost: one-time migration;
  the restructure work (Track B) is the same either way.

**Discriminator — what's the actual pain?**
- Cognitive sprawl in the session layer → **Track B fixes it in either repo.**
- Wanting a clean slate / clean history → **B.**
- "Don't touch a working thing" + speed → **A.**

**Recommendation:** **B, if you want the clean-slate feel** — seed KLONE from the branch, adopt the
modular-monolith top-level layout, then run Track B (the Session library + feature packaging)
incrementally and test-green here. Otherwise **A**. Either way the end-state shape is identical, and
**step zero is backing up the unpushed branch.**

---

## 10. Decision + execution plan — chosen 2026-07-02

**Decision: Option B** — seed KLONE from `refactor/foundation`, continue Track B here. (Chad.)

**Order (nothing moves until Chad OKs the seed):**

0. **Safeguard.** `git bundle` the KAFI `refactor/foundation` branch to a safe file — a single-file
   backup of the 14 unpushed commits (local, no remote needed). Nothing else touches KAFI.
1. **Seed KLONE** from the branch's working tree. *History mode = Chad's call:* fresh `git init`
   (clean history; the seeded tree = commit 1) **or** full `git clone` (carry all commits + journal).
2. **Verify green FIRST.** `pnpm install` + `pnpm test` in KLONE → prove the seed is faithful
   (2176 tests) **before touching anything.** Never restructure on red.
3. **Document the target layout** (kernel / leaves / spine / composition) + sanction the
   `brain`/session home. Docs + conventions — not a big-bang move.
4. **Track B on rails** (incremental; each step `pnpm test`-green + `code-reviewer`):
   B-lead = extract the brain/session library — **one parametric Session primitive**
   (scope · tool-set · sink · realtime-stream · background · tracking) → pilot **`@vynel/knowledge`**
   (prove lift-and-re-export) → leaf-by-leaf (memory, files, capabilities, marketplace, agents,
   approvals; + voice consolidation).
5. **Then the net-new surfaces:** the `vynel` **CLI** (over `@vynel/sdk`), **memory backup/restore**,
   the **cloud marketplace backend**, and the **full desktop-app shell** (resolve Tauri-vs-Electron).

**Carries as-is (verified):** `@vynel/providers`, `@vynel/db`, `@vynel/errors`, `@vynel/approvals`,
the MCP pipeline (`mcp-contract` + `sdk` + `apps/mcp` generator + parity guards), api core DI.
Stubs (`config`/`pubsub`/`queue`/`feature-flags`) stay as interfaces. CLI is the one empty surface.
