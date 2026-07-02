# Vynel — current scaffold (as-built)

> What **actually exists** in the repo today, laid out for reviewing the shape.
> Companion to `docs/architecture.md` (the *target*); this is *as-built*, after the
> knowledge scope+sources work. `pnpm test` green: 86 files / 521 tests.

---

## 1. The tree — only what EXISTS today

```
vynel/
├── packages/                         internal libraries (imported; no process)
│   ├── db/         KERNEL — schema/<domain>/ + repositories/<domain>/ for ALL domains
│   │               + client · migrate · dialect · migrations-sqlite/ (0000..0038)
│   ├── errors/     VynelError taxonomy        (kernel-shared, dependency-free)
│   ├── logger/     pino behind a type-only interface (kernel-shared)
│   ├── testing/    withTestDatabase — real SQLite temp file (dev only)
│   ├── embeddings/ MiniLM-L6-v2 embed()       (stateless helper — owns NO tables)
│   ├── indexer/    parsers + recursive chunker (stateless helper — owns NO tables)
│   ├── knowledge/  ★ the ONE built LEAF feature — logic only (indexing/queries/lifecycle/sources)
│   ├── core/       SPINE slice — users/ · workspaces/ · _shared/ (ops that stay in core)
│   └── sdk/        generated typed client (flat + namespaced) from the api's OpenAPI
│
├── apps/                             deployables (thin adapters — never imported by packages)
│   ├── api/        Hono daemon — knowledge routes + user/workspace middleware + DI factory
│   ├── cli/        `vynel knowledge <search|list|get|status|reindex>` over the namespaced SDK
│   ├── worker/     in-process cron — the generate-knowledge-embeddings job
│   └── mcp/        external stdio MCP server (direction ②) + generated api-tools registry
│
└── scripts/        generators (OpenAPI→SDK, OpenAPI→MCP tools) + 3 parity guards
```

### Detailed tree — every folder that exists today

```
vynel/
├── packages/
│   ├── db/                                   ← KERNEL (owns ALL schema + repos)
│   │   ├── src/
│   │   │   ├── schema/                        one folder per domain (~17)
│   │   │   │   ├── users/            users.ts · user-preferences.ts
│   │   │   │   ├── workspaces/       workspaces.ts
│   │   │   │   ├── knowledge/        sources.ts · documents.ts · chunks.ts · index.ts
│   │   │   │   ├── memory/           memory-entries.ts · memory-entry-mentions.ts
│   │   │   │   ├── chat/             chat-sessions.ts · chat-messages.ts · chat-tool-calls.ts
│   │   │   │   ├── approvals/        approval-rules.ts · approval-requests.ts
│   │   │   │   ├── agents/           agents.ts · agent-skills.ts
│   │   │   │   ├── channels/         channels.ts · channel-user-links.ts · channel-inbound-messages.ts · channel-message-queue.ts
│   │   │   │   ├── skills/           installed-skills.ts · skill-settings.ts
│   │   │   │   ├── schedules/        schedules.ts · schedule-runs.ts
│   │   │   │   ├── capabilities/     workspace-capabilities.ts
│   │   │   │   ├── files/            file-activities.ts
│   │   │   │   ├── providers/        provider-preferences.ts
│   │   │   │   ├── onboarding/       onboarding-runs.ts
│   │   │   │   ├── session-continuity/  root-sessions.ts
│   │   │   │   ├── orchestration/    delegation-jobs.ts
│   │   │   │   └── _shared/          outbox-events.ts
│   │   │   ├── repositories/                  mirrors schema/ — one folder per domain
│   │   │   │   ├── knowledge/  sources.ts · documents.ts · chunks.ts · search.ts · index.ts  (+ *.test.ts)
│   │   │   │   └── users/ · workspaces/ · _shared/ · memory/ · chat/ · …  (functional, db-first)
│   │   │   ├── migrations-sqlite/  0000_*.sql … 0038_knowledge_sources_scope.sql · meta/{_journal, *_snapshot}.json
│   │   │   ├── client.ts · migrate.ts · dialect.ts · index.ts
│   │   └── package.json
│   ├── errors/      src/index.ts              (VynelError taxonomy — dependency-free)
│   ├── logger/      src/index.ts              (pino behind a type-only interface)
│   ├── testing/     src/                       (withTestDatabase + fixtures)
│   ├── embeddings/  src/                       (generateEmbedding — MiniLM-L6-v2)
│   ├── indexer/     src/ parsers/{md,pdf,docx,html,csv,json,txt} · chunking/
│   ├── knowledge/   src/                      ★ THE ONE BUILT LEAF (logic only)
│   │   ├── indexing/   index-file · index-source · file-watcher · content-hash ·
│   │   │               remove-file-from-index · upsert-skipped-document ·
│   │   │               generate-knowledge-embeddings · force-reindex-workspace     (+ *.test.ts)
│   │   ├── queries/    search-knowledge · list-documents-for-workspace ·
│   │   │               get-document-detail · get-indexer-status
│   │   ├── lifecycle/  handle-workspace-created · handle-workspace-removed
│   │   ├── sources/    register-knowledge-source · remove-knowledge-source ·
│   │   │               list-knowledge-sources · path-safety
│   │   └── knowledge-types.ts · knowledge-events.ts · _test-helpers.ts · index.ts (barrel)
│   ├── core/        src/ users/ · workspaces/ · _shared/          (SPINE ops)
│   └── sdk/         src/ index.ts · errors.ts · generated/{api.d.ts, namespaced.ts} · openapi.json
│
├── apps/                                      ← thin adapters (never imported by a package)
│   ├── api/    src/ app.ts · factory.ts · server.ts · env.ts · openapi.ts ·
│   │           middleware/{user-resolver, workspace-resolver} · handler-bundles/ ·
│   │           routes/knowledge/{index, schemas, serializers}.ts
│   ├── cli/    src/ bin.ts · index.ts · knowledge-commands.ts · output.ts · env.ts
│   ├── worker/ src/ index.ts · factory.ts · scheduler.ts · env.ts ·
│   │           jobs/knowledge/generate-knowledge-embeddings.ts
│   └── mcp/    src/ external-mcp-server.ts · external-server.ts · index.ts · env.ts ·
│               mcp-types.ts · generated/api-tools.ts
│
├── scripts/src/generators/  generate-sdk · generate-mcp-tools · generate-namespaced-sdk ·
│                            namespaced-sdk/{parse,tree,emit,types} · check-{schema,mcp,sdk}-parity
├── docs/       vision.md · architecture.md · restructure-research.md · scaffold.md ·
│               module-notes/ · decisions/
├── .claude/    STATE.md · ceo/{soul.md, memory/} · rules/ · journal/ · agents/ · commands/
└── (root)      drizzle.sqlite.config.ts · pnpm-workspace.yaml · turbo.json ·
                tsconfig.base.json · package.json · CLAUDE.md
```

**NOT built yet** (still in the old repo `E:\KAFI\WORKSPACE\v2\vynel`, pulled module-by-module):
`providers` (the AI seam), `session` (the brain), and the `memory`/`agents`/`channels`/
`schedules`/`marketplace`/… **feature packages**, plus `contracts`/`config`/`mcp-contract`.
**Their schema + repositories already exist in `@vynel/db`** (seeded whole) — only their
**logic packages** are unbuilt. So today the DB knows ~17 domains; only **knowledge** (+ users/
workspaces via `core`) has its logic pulled.

---

## 2. The layering — imports point DOWN only

```
SURFACES   apps/  api · cli · worker · mcp          thin; NEVER imported by a package
   ▲  (import down only)
LEAVES     @vynel/knowledge  (+ future memory / agents / …)   logic; imports kernel only
   ▲
SPINE      @vynel/core  (users · workspaces · _shared)        composes; stays in core
   ▲
KERNEL     @vynel/db (schema + repos + client + migrate)  ·  @vynel/errors · @vynel/logger
```

A leaf imports **only** the kernel + shared. It never imports a sibling leaf and never FKs
into another feature's tables — cross-feature links are **loose refs mirrored through the
outbox**. That downward-only graph is *why* a feature is liftable.

---

## 3. Why THREE places? (the deep dive)

The thing you're pressure-testing: `knowledge` shows up in `db/schema/knowledge`,
`db/repositories/knowledge`, **and** `packages/knowledge`. That is not three copies of one
thing — it's **two separate splits stacked on top of each other.** Pull them apart and it
stops looking repetitive.

### 3.1 — Split #1: by LAYER (three questions, three jobs)

Each place answers a **different question** about the domain:

| Place | Question it answers | Consumed by | Knowledge |
|---|---|---|---|
| `db/schema/<d>/` | **What IS the data?** — tables, columns, types, FKs | drizzle-kit (migrations) + the type system | `sources` · `documents` · `chunks` |
| `db/repositories/<d>/` | **How do I read/write it?** — `find`/`insert`/`update`/`search`, `db` first arg, *no business rules* | the feature's logic | `documents` · `chunks` · `search` · `sources` |
| `packages/<d>/` | **What does the feature DO?** — orchestration + rules | the app surfaces (routes/cli/worker) | `indexFile` · `searchKnowledge` · the watcher · `registerKnowledgeSource` |

This is the classic **repository pattern**, and each split earns its keep:
- **schema ≠ repositories** — *different consumers.* The schema is a pure declaration that
  drizzle-kit reads to generate migrations; the repositories are the *runtime* query
  implementations features call. Merge them and you bolt query functions onto migration input,
  bloat the files, and blur "what the data is" with "how you fetch it."
- **repositories ≠ logic** — raw data access has *no business rules.* `insertDocument` just
  writes a row; `indexFile` decides *whether* to skip / parse / hash-skip / chunk, then persists
  *through* the repos and emits the outbox event. Keep rules out of access → both are testable
  in isolation, and one op can compose many repos.

If you ever wanted *fewer* places, this is the wrong split to collapse — mixing declaration +
access + rules is exactly the tangle that made the old repo *feel* like it was collapsing.

### 3.2 — Split #2: by HOME (kernel vs feature) — the load-bearing reason

Two of the three places (schema + repos) live in the **kernel** (`@vynel/db`); only the logic
lives in the **feature package**. That is not arbitrary — it's forced by **one hard fact:**

> **There is exactly ONE physical database.** Every table foreign-keys into `users`/`workspaces`
> (cascade on delete), and every state change co-commits its outbox event in the **same**
> `db.transaction`. Splitting the db per-feature breaks both — a microservices rewrite of a
> working product. (Settled in `restructure-research.md`.)

Given one db, the schema must be **centralized somewhere** so Drizzle emits one migration set
and FKs resolve. There are only two honest ways to centralize:

- **Kernel owns it (today).** All schema sits in `@vynel/db`. Consequences: the kernel is
  self-contained and knows *nothing* about any feature · dependencies point cleanly **down**
  (features → kernel, never up) · the **entire data model is visible in one folder** · migrations
  are one config + one folder. Cost: a feature's files span the kernel + its own package (the
  "3 places").

- **Feature owns it (vertical slice), aggregated at a composition point.** Each feature holds
  its own `schema/` + `repositories/`; a config module imports every feature's schema to feed
  Drizzle. It *looks* more self-contained — but the coupling that actually matters (the FKs, the
  one shared file, the atomic outbox) **does not move with the folders.** `knowledge` is still
  "nothing without the kernel." So you pay real tooling + scatter the data model across N
  packages to buy a **feature-locality** win (a *real* one — see §3.5) — and the aggregator now
  must know every feature, a reach the clean "kernel knows no leaves" model avoids.

**So the 3 places = (3 layers) minus (1 layer that can't leave the kernel).** Logic is free to
live with its feature; schema + repos are pinned to the kernel by the one-db invariant.

### 3.3 — How the giants handle exactly this

No data-driven monolith makes a feature physically db-independent, because a **stateful** feature
*can't* be — the database is the **platform**, like the standard library:
- **Rails** — one shared `db/schema.rb` + `app/models/` + service objects. A model is useless
  without ActiveRecord + the db; nobody calls that a flaw.
- **Django** — models per app, but one shared ORM + settings; an app can't run standalone.
- **Spring / .NET modular monoliths** — modules over a shared data layer; boundaries enforced by
  convention + tooling (Packwerk, ArchUnit), **not** by giving each module its own database.

The lesson the survivors teach: **reusability = clean boundaries, not physical independence.**
Ours are already right — a leaf imports only the kernel, never a sibling; no cross-feature FK;
features talk through the outbox. You can lift `knowledge` + the kernel into another Vynel; you
cannot lift it *without* the kernel, and you shouldn't want to.

### 3.4 — Verdict + when we'd revisit

**Keep the three places.** The coupling is in the *data*, not the folders; the friction (a
feature = 3 folders) is **constant** — 3 folders at 1 feature or 50, it never compounds; and
"can't do complexity" breaks a close call toward the simpler tooling. What genuinely rots at
scale — a split db, cross-feature FKs — is already forbidden by the invariants (§5).

Revisit the vertical slice **only** if the north-star flips from "clean modular monolith" to
"third-party-installable feature packages" — and even then it needs the kernel-FK problem solved
first (far bigger than moving folders). The cheap fix for the navigation friction *today* is a
dev aid — a one-line "knowledge = these 3 homes" pointer per feature — never a restructure.

### 3.5 — Web check (verified July 2026)

Cross-checked against the field, not just asserted — and it *refines* the above (honest record):

- **Repository pattern (§3.1) — confirmed.** Separating data access from domain logic is textbook
  (Fowler): isolation, testability, flexibility. Keep it.
- **The "a feature makes you touch 3 layers" friction is a REAL, named downside of layered
  architecture** — not pickiness. **Vertical slice exists specifically to fix it** via code
  locality. So the instinct flagging this is well-founded.
- **Modular-monolith best practice actually leans toward each module owning its data** (separate
  schema per module, for isolation) — *closer to vertical slice* than to our shared kernel. So
  "cosmetic" (§3.2) was too glib: it's a legitimate, arguably-preferred pattern. Its real costs
  are more duplication + reduced consistency + harder shared tests.

**Reconciliation:** it's a genuine trade-off ("prioritize horizontality or verticality" — no free
lunch), and *our* reasons to keep the shared kernel are **Phase-1-specific**, not universal:
(a) **SQLite has no schemas** — the per-module-schema isolation trick needs Postgres/SQL-Server, so
in Phase 1 our isolation is code-level anyway; (b) we deliberately **FK every feature into
`users`/`workspaces`** for integrity — strict modular monoliths *avoid* cross-module FKs, and that
choice pins the schema together; (c) **"can't do complexity"** — shared kernel is the simpler tooling
today. → **Shared kernel = the right *pragmatic Phase-1* call; vertical slice = a legitimate *Phase-2*
evolution** (it pairs naturally with Postgres schemas + real installability), not a dead end.

**Sources:** [Fowler — domain-logic / repository patterns](https://enterpriseapplicationpatterns.blogspot.com/2018/12/domain-logic-patterns-martin-fowler.html)
· [Jovanović — Modular Monolith Data Isolation](https://www.milanjovanovic.tech/blog/modular-monolith-data-isolation)
· [Grzybek — Modular Monolith Integration Styles](https://www.kamilgrzybek.com/blog/posts/modular-monolith-integration-styles)
· [Ozkaya — Data Isolation Strategies](https://mehmetozkaya.medium.com/data-management-in-modular-monoliths-4-data-isolation-strategies-1042667a099c)
· [NILUS — Layered vs Vertical Slice](https://www.nilus.be/blog/layered_architecture_vs_vertical_slice_in_modular_monoliths/)
· [Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)

---

## 4. Knowledge — the pilot, end to end

- **Schema** — `sources` (registry: workspace/global scope), `documents` (+`sourceId`/`scope`,
  `workspace_id` nullable), `chunks`. Two virtual search tables via SQL migration:
  `knowledge_chunks_fts` (FTS5) + `knowledge_chunks_vec` (sqlite-vec, keyed on `source_id`).
- **Migration** — `0038_knowledge_sources_scope.sql` + a **behavioral** test that seeds a
  populated old-shape DB, migrates, and asserts FTS + vector search still return the chunk.
- **Repos** — sources / documents / chunks / search (source-fused: a workspace's sources + the
  user's global sources).
- **Logic** — `indexing/` (index-file, index-source, file-watcher, embeddings, …),
  `queries/` (search, list, get-detail, status), `lifecycle/` (workspace created/removed),
  `sources/` (register / remove / list + path-safety).
- **Surfaces** — api: 5 read routes (**add-directory NOT wired yet — Stage-2**); cli: knowledge
  cmds; worker: embeddings job; mcp: 4 read tools. SDK regenerated from the api's OpenAPI.

---

## 5. Invariants (the rules that keep it from breaking)

1. `packages/` never import from `apps/`. Imports point down only. No cycles.
2. A leaf imports only kernel + shared — **no sibling-leaf import, no cross-feature FK** (loose-ref + outbox).
3. **One** shared `@vynel/db`. No physical per-feature DBs. No raw SQL outside `repositories/`.
4. No business logic in routes: parse → validate → call core → shape response.
5. Every state change co-commits its outbox event in one `db.transaction`.
6. `@anthropic-ai/claude-agent-sdk` *runtime* only inside `packages/providers/` (unbuilt); its
   MCP *builder* primitives are allowed in the MCP layer.
7. TS strict/ESM; `.js` on every relative import. Real DB in tests (never mocked). Every change ships tests.

---
*As-built through commit `d859256`.*
