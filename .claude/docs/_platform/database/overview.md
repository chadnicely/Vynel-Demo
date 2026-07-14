# Database — Overview

> Vynel's two data kernels: the desktop's local SQLite store that holds *your* data, and the hub's Postgres store that holds *ours* — same house style, kept deliberately apart.
>
> **Status:** shipped · **Depends on:** nothing but shared [errors](../primitives/overview.md) — this is the floor of the import graph · **Code map:** [structure.md](./structure.md)

## Purpose

Almost nothing in Vynel touches a database directly. Two small kernel packages own that job, and every other module reaches storage only through them. This chapter documents both together because they are the same idea built twice for two different worlds:

- **The desktop kernel** is the on-device store. It runs inside the app on the user's own machine and holds *their* stuff — workspaces, memory, files, chat, provider preferences, agents. It is SQLite today.
- **The hub kernel** is the server-side store. It runs on Vynel's own infrastructure and holds *our* stuff — who has an account, what tier they're on, which webhook deliveries we've already seen. It is Postgres, and it never runs on a user machine.

Both are **plumbing, not a product surface**. There is no screen, no user verb, nothing a person opens. What they provide is a single, disciplined way for the rest of the system to read and write rows: one database technology per world, one query builder, one repository convention, one testing story, one migration path. The value is uniformity — a teammate who learns how one table's data functions work has learned how all of them work, in either kernel.

The single most important thing to hold in your head: **these two kernels never mix.** They share no rows, no connections, and no imports. Product data lives in the desktop kernel; Vynel's server-side truth lives in the hub kernel; the only thing they have in common is house style.

## What it provides

This is infrastructure, so there are no user-facing actions — only what the kernels give the rest of the codebase:

- **A typed database handle** each world's code passes around, produced by a small connection factory that also wires in per-world setup (the desktop connection loads its vector-search extension and sets its write-ahead and foreign-key pragmas; the hub connection defaults to pooler-safe settings and can size its pool).
- **A dialect-agnostic column vocabulary** (desktop only) — schema files declare columns like *identifier*, *timestamp*, *boolean*, *json*, *bytes* through shared helpers instead of reaching for a specific SQL dialect, so the same schema can one day target Postgres without being rewritten.
- **A functional repository convention** — every data function takes the database handle as its first argument and is otherwise stateless. A *finder* returns null when the row is absent; a strict *getter* throws a typed error. No repository is ever a class.
- **A shared transactional outbox** (desktop) — a single cross-cutting table every event-publishing feature writes to, so a state change and the event announcing it land in one transaction or not at all. Features never link to each other directly; they link through this.
- **Boot-time migrations** — a runner that brings a database up to the committed schema before the app serves traffic, reading from one committed folder of migration files per kernel.
- **A real-database testing seam** — every test gets a fresh, throwaway *real* database (a temp SQLite file on the desktop side, an in-process Postgres for the hub), migrated exactly as production is. The database is never mocked.

## Responsibilities

**Owns** — the connection factories and typed handles for both worlds; the desktop's dialect helper vocabulary and its snake-case column-naming convention (the hub shares the naming convention); the functional repository pattern and its finder-returns-null / getter-throws contract; the shared outbox table and its query functions; the account records and webhook-dedup log that form the hub's kernel-core; the migration runners and the committed migration folders for each kernel; and the real-database test helpers both worlds use.

**Does not own** —
- **any feature's own tables or business logic** — the kernels supply the substrate and the pattern; each feature ships its own schema and data functions on top (e.g. [memory](../../memory/overview.md), [chat](../../chat/overview.md), [workspaces](../../workspaces/overview.md), [knowledge](../../knowledge/overview.md), [agents](../../agents/overview.md));
- **when migrations run and when connections close** — each app's boot and shutdown path calls the runner and the close helper ([local-api](../../_apps/local-api/overview.md) for the desktop, the hub app for Postgres);
- **environment configuration** — no kernel reads process configuration itself; the validated database path or URL is passed in from each app's own settings boundary;
- **the embedding vectors themselves and how they're computed** — the desktop kernel only makes the vector-search extension *available*; producing embeddings belongs to [embeddings](../embeddings-and-indexing/overview.md);
- **who provisions accounts** — the hub kernel stores account rows, but they are created by Vynel's provisioning platform over webhooks, not self-serve; the desktop app only signs in.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Kernel** | A single shared database package that every other module builds on. There are two, one per world. |
| **Desktop kernel** | The on-device store — SQLite via `better-sqlite3`, holding the user's own data. Bottom of the desktop import graph. |
| **Hub kernel** | The server-side store — Postgres via `postgres-js`, holding Vynel's account and platform truth. A wholly separate package. |
| **Database handle** | The typed object every data function takes as its first argument. Same idea in both kernels; different underlying driver. |
| **Dialect seam** | The desktop kernel's set of technology-neutral column helpers. It resolves to SQLite in Phase 1 always, and exists so the same schema *could* target Postgres later. |
| **Repository** | A file of stateless data functions for one table. Functional, handle-first — never a class. |
| **Finder vs. getter** | The two read shapes: a finder returns null when nothing matches; a getter throws a typed error. Both worlds follow this. |
| **Outbox** | The desktop's shared cross-feature event table. A state change and its announcement co-commit; features integrate through it instead of importing each other. |
| **Migration folder** | The one committed set of ordered schema-change files per kernel, replayed at boot and in tests. |
| **Test database** | A fresh, real, throwaway database handed to each test — a temp SQLite file locally, an in-process Postgres for the hub. Never a mock. |
| **Account (hub)** | The hub's kernel-core row: who a user is, their tier, status, and role. Referenced by every future cloud feature the way the desktop's user row anchors local data. |
| **Webhook-dedup log (hub)** | A record of platform event ids already processed, making at-least-once webhook delivery apply exactly once. |

## Rules & invariants

- **The two kernels never mix.** No package imports one from the other; they share no rows and no connections. The user's data lives in the desktop kernel; Vynel's server-side truth lives in the hub kernel. This is the load-bearing separation of the whole chapter.
- **The desktop kernel is the floor of its import graph.** It imports nothing but shared building blocks and is imported by everything with data. The hub kernel is equally low, depending only on the shared errors package.
- **Every data function takes the handle first and is stateless.** No repository holds connection state; no repository is a class. Finder returns null, getter throws.
- **Schema files on the desktop side never name a SQL dialect.** They declare columns through the shared dialect vocabulary, so the SQLite-vs-Postgres decision lives in exactly one place.
- **The desktop kernel is SQLite in Phase 1 — always.** The dialect seam is Postgres-*ready*, not bi-dialect. The Postgres branch of this kernel is deliberately unbuilt; today every path resolves to SQLite. (The hub's Postgres is a *different* kernel, not the realization of this seam.)
- **The hub kernel is Postgres-only by design.** It never runs on a user machine, so it carries no dialect seam at all. Its production connection defaults to pooler-safe settings, and its migrations run against the direct, unpooled connection.
- **Phase-1 desktop transactions are synchronous.** The SQLite driver rejects promise-returning transaction callbacks, so desktop repositories return values directly rather than promises; the hub's Postgres repositories are async. The call sites are written so a future async swap on the desktop side is transparent.
- **Every desktop state change co-commits its outbox event** — the row and the event land in one transaction, or neither does.
- **Tests always run against a real database, never a mock.** Each test gets a fresh throwaway store migrated the same way production is; teardown deletes it.
- **Column names are snake-case in SQL, camelCase in code.** Both kernels rely on the same automatic casing conversion, so schema files stay TypeScript-idiomatic while the database stays SQL-idiomatic.

## Where it sits in the bigger picture

The desktop kernel is the quiet foundation under every on-device feature: [memory](../../memory/overview.md), [chat](../../chat/overview.md), [workspaces](../../workspaces/overview.md), [knowledge](../../knowledge/overview.md), [files](../../files/overview.md), [providers](../../providers/overview.md), [agents](../../agents/overview.md), and [onboarding](../../onboarding/overview.md) all ship their own tables and data functions on top of it, and announce cross-feature events through its shared outbox. The [local-api](../../_apps/local-api/overview.md) app owns its lifecycle — running migrations at boot, closing the connection at shutdown, and scheduling the ticks that drain the outbox. The hub kernel sits under an entirely separate branch of the product — the server-side account and platform surface that the desktop app authenticates against — and is the floor for the cloud features (registry, plans, entitlements) that reference an account the way local data references a user. Today the hub kernel holds only that account kernel-core and a webhook-dedup log; the rest is referenced as future work. Both kernels look and feel the same on purpose, and are kept apart on purpose: learn one and you can read the other, but nothing ever reaches across the line between them.

---
*Mapped from the code on disk, 2026-07-14. If you change this module, update this file and [structure.md](./structure.md).*
