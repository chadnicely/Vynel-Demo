# Vynel — Repository Architecture (the scaffold)

**Created:** 2026-07-02 · **Status:** the frame we pour code into · **Companion:** `restructure-research.md`

> This document defines the **shape** — how the repo is organized, how packages stay **reusable**,
> and the **rules that keep it from breaking** as it grows. It is the target for the module-by-module
> code move (§10). Read this + `CLAUDE.md` before writing or moving anything.

---

## 0. First principles

1. **One brain, many hands.** The user talks to one assistant per workspace; agents are its tools.
2. **Layered core, thin surfaces.** All logic lives in `packages/`; `apps/` are thin adapters. Every
   capability is one core operation with many callers (route, CLI, worker, channel).
3. **Everything is a session.** Global, workspace-root, and agent-task are all *sessions* served by
   one parametric Session primitive (§5).
4. **Provider-agnostic.** The AI runtime is reached only through `AiAgentProvider`. Swapping/adding a
   runtime touches one folder.
5. **Local-first, cloud-ready.** Phase 1 = one SQLite file per machine, no auth. Every row carries
   `userId`; every repo is dialect-agnostic — so Phase 2 (Postgres/cloud) is data-only, not a rewrite.
6. **Visible & approved.** Memory is readable/editable; every irreversible action passes an approval
   card. Safety is a behavior layer, not a permission enum.

---

## 1. The layer model (dependency direction is the whole game)

```
                 SURFACES (apps/)  — thin; never imported by packages
     api · web · desktop · voice · worker · mcp · cli
                        │  (import ▼ only)
   ─────────────────────┼──────────────────────────────────
     COMPOSITION         │  the brain / session library — assembles a turn
       (@vynel/session, app-composition)
                        │
     SPINE               │  chat · orchestration · session-continuity · onboarding
       (stays in core; composes leaves — do NOT library-ize)
                        │
     LEAVES              │  knowledge · memory · files · capabilities · marketplace ·
       (@vynel/<feature>)│  agents · approvals · channels · voice · skills · schedules
                        │  + stateless: desktop-control · embeddings · indexer · providers
                        │
     KERNEL              │  @vynel/db (users · workspaces · _shared/outbox · dialect · client ·
       (small, stable)   │  migrate · transactions)  +  errors · logger · contracts · config
```

**The one rule that keeps it from breaking — imports only ever point down:**

- `packages/` **never** import from `apps/`. `apps/` may import any package.
- A **leaf** imports only the **kernel** + **shared** (`errors`/`logger`/`contracts`/`config`). It
  **never** imports another leaf, and **never FKs into another leaf's tables** — cross-feature links
  are **loose refs mirrored through the outbox** (`_shared/outbox`).
- The **spine** may compose leaves. The **composition layer** assembles spine + leaves into a turn.
- No import cycles. Ever.

That downward-only graph is *why* a feature can be lifted into a reusable package: it only depends on
the small stable kernel beneath it.

---

## 2. The tree

```
vynel/
├── apps/                      # deployables / long-lived processes (thin)
│   ├── api/                   # Hono HTTP + SSE daemon — the brain process (local; cloud in P2)
│   ├── web/                   # Vue 3 SPA — chat, panels, settings
│   ├── desktop/               # desktop shell hosting web + the voice overlay (Tauri today — §8)
│   ├── voice/                 # always-on "Jarvis" — wake-word → STT → TTS → /root/turn → speak
│   ├── worker/                # in-process cron scheduler (P1) → queue (P2)
│   ├── mcp/                   # external MCP server + the generated tool registry
│   └── cli/                   # NEW — `vynel` CLI over @vynel/sdk (net-new surface)
│
├── packages/                  # internal workspace libraries (imported; no process lifecycle)
│   ├── db/                    # KERNEL — schema + repositories + dialect + client + migrate
│   ├── errors/ logger/ contracts/ config/         # shared cross-cutting
│   ├── providers/             # AiAgentProvider abstraction + Claude impl (the AI seam)
│   ├── embeddings/ indexer/   # stateless helpers (local MiniLM; parsers + chunker)
│   ├── mcp-contract/ sdk/     # the MCP descriptor contract + generated typed client
│   ├── session/               # COMPOSITION — SessionMode, SessionSink, the root-turn runner
│   ├── knowledge/ memory/ files/ capabilities/ marketplace/ agents/ approvals/
│   │   channels/ skills/ schedules/ voice/         # LEAVES (@vynel/<feature>)
│   ├── desktop-control/       # desktop MCP tools (a11y read + gated act)
│   ├── testing/               # withTestDatabase + fixtures (real SQLite, never mocked)
│   ├── pubsub/ queue/ feature-flags/               # P1 stubs → P2 impls (interfaces now)
│   └── core/                  # SPINE ops + re-export shim during the module-by-module move
│
├── scripts/src/generators/    # OpenAPI→SDK, OpenAPI→MCP tools, parity guards, context-pack
├── docs/                      # architecture.md · restructure-research.md · blueprints/ · guidelines
├── infra/                     # P2 only (compose, terraform, k8s, pgbouncer)
├── .claude/                   # Claude Code workspace: rules/ commands/ agents/ docs/ journal/
├── CLAUDE.md · package.json · pnpm-workspace.yaml · turbo.json · tsconfig.base.json
└── .env.example · .gitignore · README.md
```

---

## 3. The reuse contract — what makes a feature a reusable `@vynel/<feature>`

A **leaf feature package** is reusable precisely because it obeys a fixed shape:

| It OWNS | It DEPENDS on | It EXPOSES |
|---|---|---|
| its tables — `@vynel/db/schema/<domain>/` (referencing the kernel) | the **kernel** (`@vynel/db`) + shared (`errors`/`logger`/`contracts`/`config`) | one clean `src/index.ts` public surface |
| its repositories — `@vynel/db/repositories/<domain>/` (functional, `db` first arg) | **nothing from `apps/`**, **no sibling leaf** (loose-ref + outbox only) | **functional** operations that take deps as arguments (no hidden globals) |
| its core operations — the domain logic | `@vynel/providers` only via injected deps, never `claude-agent-sdk` directly | its lifecycle **outbox events** (the only cross-feature seam) |
| *(optional)* its `McpFeatureDescriptor` — one object → auto-attaches its tools everywhere (§6) | | *(optional)* its routes (`apps/api`), worker jobs (`apps/worker`), UI (`apps/web`) — thin |

**Litmus for "library-shaped":** the feature FKs only into the **kernel**, never into a sibling. The
four already-perfect libraries (`desktop-control`, `embeddings`, `indexer`, `providers`) own **zero**
DB tables — "feels like a library" == "owns no cross-feature storage."

**Why not physically separate DBs?** Settled in research: kernel FKs (`users`/`workspaces`, cascade)
+ same-transaction outbox atomicity require **one shared `@vynel/db`**. The "installable" feel is
delivered at the **code + MCP layer**, not by splitting storage. Third-party `pnpm install` of a
stateful feature is a north-star, not a Phase-1 goal.

---

## 4. The kernel

The small, stable core every feature imports. Changes here are rare and reviewed hard.

- **`@vynel/db`** — `users`, `workspaces`, `_shared/outbox`, `dialect` (SQLite↔Postgres helpers),
  `client`, `migrate`, `transactions`. One connection, one DB file (P1). `foreign_keys=ON`.
- **`@vynel/errors`** — the `VynelError` taxonomy (one `onError` switch maps them to HTTP).
- **`@vynel/logger`** — structured pino behind a type-only interface.
- **`@vynel/contracts`** — shared Zod schemas + inferred types, promoted on the *second* consumer.

Every state change **co-commits its outbox event in one `db.transaction`**. That atomic outbox is the
backbone of cross-feature decoupling and future cloud sync.

---

## 5. The session model — "everything is a session"

One **parametric Session primitive** serves every session type; the differences are parameters:

```
Session({
  scope:      'global' | 'workspace' | 'agent',   // who/what this session is
  toolSet:    McpFeatureDescriptor[],             // which capabilities attach (§6)
  sink:       SessionSink,                         // where events go (SSE / channel / recorder)
  realtime:   stream deltas live,                  // built-in, not per-type
  background: run detached,                         // built-in
  tracking:   monitor tree + activity log,         // built-in
})
```

- **Continuity is intrinsic:** a stable `rootSessionId` maps to a swappable SDK session; at context
  pressure the runner distills → seeds a fresh session → repoints the root — invisibly.
- **Hierarchy:** global root routes to workspace roots (`/routing/*`); workspace roots delegate to
  agent sessions; children report up the monitor tree.
- **Memory is the durable thread** carried across swaps.

This primitive is the Track-B **B-lead** extraction (today it's spread across a 29-file
`apps/api/src/sessions/` with the runner reimplemented 4–5×). Unifying it is the #1 structural win.

---

## 6. MCP everywhere — one definition, three surfaces

A capability is defined **once** and surfaces as an HTTP route, an MCP tool, and (via the SDK) a CLI
command — all **derived**, never hand-duplicated:

```
route handler + x-mcp annotation  ─►  OpenAPI 3.1 spec
                                       ├─► generate-sdk    ─► @vynel/sdk (typed client)  ─► apps/cli
                                       └─► generate-mcp    ─► apps/mcp tool registry
McpFeatureDescriptor (per feature) ─►  composeSessionMcpServers()  ─► every session turn (agent SDK)
                                       └─► apps/mcp external HTTP adapter (other clients)
```

- Two **CI parity guards** (`check-mcp-parity`, `check-schema-parity`) fail the build on drift.
- A descriptor declares `mutatingToolNames` → destructive tools **auto-card** for approval.
- `gatedByCapability` → the user's capability toggles turn tools on/off.

Adding a feature = ship a descriptor; it plugs into api + agent-SDK with **no per-entry-point edits**.
The remaining consumer to build is **`apps/cli`** over `@vynel/sdk`.

---

## 7. Surfaces & how a "desktop request" flows

All surfaces are thin clients of the same core.

- **`apps/api`** — the daemon (local HTTP + SSE). Hosts the session runtime + boot services
  (channels, schedules, delegation).
- **`apps/desktop`** — the shell hosting `apps/web` + the voice overlay. Talks to the api daemon.
- **`apps/cli`** — thin client over `@vynel/sdk`; every MCP-exposed capability becomes a command.
- **A desktop request** (mouse/keyboard/screen/notifications) is **not a bespoke path**: the
  `@vynel/desktop-control` `McpFeatureDescriptor` attaches its tools to the session; the model calls
  them like any other tool; mutating ones pass the approval card.

---

## 8. Stack (locked) + two open decisions

**Locked (keep):** Node 22 · TS ^5.4 strict/ESM · Hono v4 · Drizzle · better-sqlite3→Postgres ·
SSE + in-process pub/sub→Redis · Vue 3 + Vite + Pinia + Tailwind · pnpm + Turborepo · Vitest ·
`@anthropic-ai/claude-agent-sdk` behind `AiAgentProvider`. Default model `claude-opus-4-8`.

**Open — decide before the surface is built, not now:**
1. **Desktop shell: Tauri vs Electron.** Tauri (tiny native binary, needs a Node sidecar) vs Electron
   (heavier, but hosts the api/session runtime in its Node main process — simpler for an always-on
   voice daemon; and it's your stack). Resolve when we build the full desktop app.
2. **When the net-new surfaces land:** `vynel` CLI · memory backup/restore · cloud marketplace
   backend. Sequenced after Track B stabilizes the core.

---

## 9. Hard rules (the invariants)

1. `packages/` never import from `apps/`.
2. A leaf imports only the kernel + shared; **no cross-feature FK, no cross-feature import** — use
   loose-ref + outbox.
3. One shared `@vynel/db`. No physical per-feature databases. No raw SQL outside repositories.
4. `claude-agent-sdk` is imported **only** inside `packages/providers/src/claude/`.
5. No business logic in routes. Routes parse → validate → call core → shape response.
6. No `process.env` outside each app's `env.ts` (Zod-validated at boot).
7. ESM only; `.js` extension on relative imports. No CommonJS.
8. Real DB in tests (SQLite temp file); never mock the database. Every change ships tests.
9. Every state change co-commits its outbox event in one transaction.
10. Move code in **module by module, test-green at every step.** Never a big-bang. Never a rewrite.

---

## 10. How we fill the scaffold (migration order)

Faithful move, then improve — each module lands green before the next:

1. **Kernel + shared first:** `@vynel/db` (+ migrations), `errors`, `logger`, `contracts`, `config`,
   `testing`, and `scripts/` (so the parity guards run). Root config + `apps/api` DI shell.
2. **`providers`** (the AI seam) — needed by any turn.
3. **Pilot leaf: `knowledge`** — feature-complete + well-tested; proves the lift-and-re-export move
   (and pulls in `embeddings`/`indexer`). Improve as we go.
4. **Leaf-by-leaf:** `memory` → `files` → `capabilities` → `approvals` → `agents` → `channels` →
   `schedules` → `marketplace`; consolidate `voice`.
5. **Composition (B-lead):** extract the one parametric **Session** primitive (§5).
6. **Surfaces & net-new:** `web`, `desktop` (resolve Tauri/Electron), `apps/cli`, memory
   backup/restore, marketplace backend.

Each step: **outline → move → `pnpm test` green → `code-reviewer` → prompt to commit.**
