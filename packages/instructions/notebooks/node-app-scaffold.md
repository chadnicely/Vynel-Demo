---
id: node-app-scaffold
title: Scaffolding a Node.js application — the house architecture
oneLiner: Open this before creating any Node.js application with data, routes, or business logic — the monorepo scaffold, module anatomy, route and schema patterns to build it from.
---

# Scaffolding a Node.js application — the house architecture

Use this shape for every Node.js application that has data, routes, or real
business logic. It is the architecture this product itself is built from: a
**modular monolith** — one repository, thin app surfaces over feature
packages, one shared database kernel. It starts small and grows for years
without a rewrite. (Choosing the stack and phasing the work comes first —
that's the **starting-a-project-from-scratch** book; a purely static site
needs none of this — see **web-app-scaffold**.)

## The shape — and the one rule that keeps it standing

```
apps/        ← thin surfaces: api, web, worker, cli … no business logic
packages/
  <feature>/ ← one package per feature: its schema, logic, and tests
  db/        ← the kernel: one shared database client, core tables, migrations
  errors/    ← typed error classes every layer throws
  logger/    ← structured logging
```

**Imports only ever point down:** apps import packages; a feature package
imports only the kernel and shared packages (`db`, `errors`, `logger`);
feature packages NEVER import each other; packages NEVER import from apps.
No cycles, ever. This one rule is why a feature stays liftable, testable,
and replaceable as the project grows.

## 1. Create the scaffold

- **TypeScript strict, ESM everywhere.** `"type": "module"`, `strict: true`,
  and the `.js` extension on every relative import. No CommonJS.
- **pnpm workspaces** (`pnpm-workspace.yaml` listing `apps/*` and
  `packages/*`); add **Turbo** for `typecheck` / `test` / `build` pipelines
  once there is more than one package.
- Root scripts the whole repo answers to: `dev`, `typecheck`, `test`. The
  gate is `pnpm test` = typecheck + the test suite. Never commit on red.
- Scaffold order: kernel (`db`, `errors`, `logger`) → first feature package
  → first app surface. Commit the clean scaffold before any feature code.
- A small project starts with ONE app (`apps/api`) and TWO or three
  packages. Do not pre-create empty packages for imagined features — a new
  package is born the day its feature is.

## 2. The database kernel — `packages/db`

One shared database for the whole application; features own tables inside
it, never separate databases.

- **SQLite via Drizzle ORM** while the project is young (one file, zero
  setup); the dialect-agnostic repository style below makes a later move to
  Postgres a data migration, not a rewrite.
- The kernel owns: the client/connection, the migration runner, and only the
  truly shared hub tables (e.g. `users`). Every feature's tables live in
  that feature's package and are exported into one schema for migrations.
- Migrations are generated (`drizzle-kit`), committed, and run at boot.
  Never hand-edit a database live.

## 3. A feature module — the package anatomy

One package per feature (`packages/orders`, `packages/customers`). Inside,
group by concern:

```
packages/orders/src/
  schema/            ← the feature's own tables
  repositories/      ← row-level reads/writes for those tables
  lifecycle/         ← operations that change state (create, update, cancel)
  queries/           ← read operations that shape data for callers
  index.ts           ← the public API: re-exports ONLY, no logic
```

- Everything a feature knows lives in its package; other code reaches it
  ONLY through `index.ts`. If two features need the same logic, extract it
  down into a shared package — never import sibling to sibling.
- Files stay under ~300 lines; one operation per file, named for what it
  does: `create-order.ts`, `list-open-orders.ts`.

## 4. Data schema — each feature owns its tables

Define tables with Drizzle in the feature's `schema/`, one file per table.
Every table follows the same skeleton:

```ts
export const orders = table('orders', {
  id: id().primaryKey(),
  userId: id().references(() => users.id, { onDelete: 'cascade' }),
  status: text().$type<OrderStatus>().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})
export type Order = typeof orders.$inferSelect
```

- Every user-owned row carries `userId`. Union columns are typed string
  columns (`$type<'draft' | 'sent'>`), enforced in code.
- A feature may FK into KERNEL tables (`users`); it never FKs into another
  feature's tables — store the foreign id as a plain reference and let each
  feature stay independent.
- Add an index for every real query path, when that path appears.

## 5. Repositories — functional, `db` first, stateless

Row access is plain functions, never classes:

```ts
export function findOrder(db: Database, orderId: string): Order | null { … }
export function getOrderOrThrow(db: Database, orderId: string): Order { … }
export function insertOrder(db: Database, row: NewOrder): Order { … }
```

- `find…` returns null; `get…OrThrow` throws the typed not-found error.
  Callers pick the one that matches whether absence is normal.
- Raw queries live ONLY in repositories; lifecycle/query operations call
  repositories, never the ORM directly.
- Multi-step state changes run inside one `db.transaction` — all or nothing.

## 6. Routes — thin, validated, typed

App surfaces (e.g. **Hono** in `apps/api`) hold zero business logic. Every
route is the same four beats: **parse → validate → call the core operation →
shape the response.**

```ts
app.post('/orders',
  validator('json', CreateOrderBodySchema),   // zod at the boundary
  (c) => {
    const body = c.req.valid('json')
    const order = createOrder(c.var.db, { userId: c.var.user.id, ...body })
    return c.json(serializeOrder(order), 201)
  })
```

- Validate every input at the boundary with zod schemas; nothing untrusted
  passes the route layer.
- Handlers THROW typed errors (`NotFoundError`, `ValidationError` — small
  classes in `packages/errors`); ONE app-level `onError` maps error class →
  HTTP status. No per-route try/catch, no swallowed errors.
- Serialize responses through one function per entity so the wire shape has
  one home.

## 7. Testing — the gate that keeps it honest

- **Vitest**, tests colocated next to the code (`create-order.ts` ↔
  `create-order.test.ts`). Every change ships its tests in the same move.
- Test against a REAL temp database file, created fresh per test via a
  shared helper in a `testing` package — never mock the database.
- The gate before any commit: typecheck green + suite green. A red gate
  stops the line — fix it before building further.

## 8. Growth rules

- New feature → new package, same anatomy. New surface (worker, cli) → new
  thin app that imports the same packages.
- Structured logging from the shared logger only — no `console.log`; never
  log secrets or personal data. Secrets come from validated environment
  config (one `env.ts` per app), never hardcoded.
- When a file tempts you past ~300 lines or a package needs a sibling's
  internals, that is the architecture asking for an extraction — do it then,
  not "later".
