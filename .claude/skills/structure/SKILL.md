---
name: structure
description: >
  The STRUCTURE view of a Vynel module (package / app / platform group) — how its code is
  built and wired: file map, schema, operations, routes, the end-to-end pipeline, and its
  connections to other modules, with real path anchors and Mermaid diagrams. One of the two
  files of the as-built docs book (`.claude/docs/`). Also used by the `wh` agent as the
  playbook for the STRUCTURE view.
allowed-tools: Read, Grep, Glob, Bash, Write
argument-hint: <unit> [output-dir]
---

Produce the **STRUCTURE** view of `$1` — the code-map half of Vynel's as-built module docs.

`$1` is the unit to document (a package under `packages/`, an app under `apps/`, or a platform
grouping). `$2`, if given, is the output directory; otherwise default to `.claude/docs/$1/`.

This file is one half of a fixed two-file set: **`overview.md`** (the idea, written separately)
and **`structure.md`** (this view — the map). Don't re-explain concepts here; anchor everything
to real code. A reader about to CHANGE this module should be able to navigate from this file alone.

## Style reference (read one before writing)

The format is inherited from the v1 doc book. Read ONE exemplar for tone and shape — e.g.
`E:\KAFI\WORKSPACE\v2\vynel\.claude\docs\memory\structure.md` (any sibling works). **Style only:
never copy v1 content — v1 is a different codebase with a different layout (central db/core
packages). THIS repo is a modular monolith of vertical-slice leaves: a feature package owns its
own `schema/`, `repositories/`, and operations under `packages/<leaf>/src/`, wired into
`apps/local-api` routes, `apps/local-web` UI, and MCP via a `McpFeatureDescriptor`. Map what is
actually on disk here.**

## Step 1 — Map the real code

Walk the unit before writing: `packages/$1/src/` (or `apps/$1/src/`), its routes in
`apps/*/src/routes/$1/`, its UI surface, its MCP descriptor, its migrations, its outbox events
(published AND consumed), and who imports it (grep for `@vynel/$1`). Verify every path you
write exists — never invent structure.

## Step 2 — Write `<output-dir>/structure.md`

Open with:

```
# <Unit> — Structure

> The code map and connections for the <unit> module. For the concepts behind it, see [overview.md](./overview.md).
>
> Folders touched: `packages/<leaf>/src/` · `apps/local-api/src/routes/<x>/` · …
```

Then these sections (a menu, not a mandate — keep the order, drop what the unit doesn't have,
add a section a shell/platform unit needs, e.g. **Boot & wiring** for an app):

1. **File map** — table of every non-test source file, `► ` marking entry points, one-line role each.
2. **Data & persistence** — each owned table: column table (type + notes), indexes, virtual
   indices/triggers, migration files. Note loose refs into other modules explicitly.
3. **Repositories** — table of repo functions (db-first) and purpose.
4. **Core operations** — table: operation · what it does · key calls (incl. outbox events, tx
   boundaries).
5. **HTTP surface** — mount point + middleware bundle, then a route table (method · path ·
   purpose · MCP tool if exposed).
6. **MCP surface** — the descriptor: tools, which are mutating (auto-card), the capability gate.
7. **Worker / background jobs** — job · schedule · what runs.
8. **Web surface** — stores, composables, views: one line each on how they hang together.
9. **Pipeline** — the unit's central end-to-end flow: a `mermaid flowchart` PLUS a numbered
   walk-through where each step anchors to a real path (`path/file.ts` or `path/file.ts:line`).
10. **Connections** — a one-line **Summary** (hub or leaf, read-side vs event-side), then a
    table: unit · direction (in/out/both) · mechanism (import / injected dep / outbox / loose id
    / SDK) · what crosses. Then **Events published** (with their tx guarantee) and **Events
    consumed** (or "none — say so"). Close with a small `mermaid flowchart LR`.
11. **Config & gotchas** — env vars, dialect notes, deliberate no-ops, known drift between docs
    /module-notes and shipped code, sharp edges the next editor must know.

Close with the provenance footer (use today's real date via `date`):

```
---
*Mapped from the code on disk, <YYYY-MM-DD>. If you change this module, update this file and [overview.md](./overview.md).*
```

## Rules

- **Accuracy over completeness** — every path, column, event name, and schedule copied from
  the code, never from memory or from v1. If unsure, re-read the file.
- Tables over prose; prose only where a connection needs explaining.
- Honest flags beat polish: mark stubs `**stub**`, unwired code `*defined but not yet wired*`,
  drift as drift.
- Relative links to sibling module docs may point at folders not yet written — fine.
- Keep Mermaid diagrams small enough to read; the tables carry the detail.

## If run directly (not by the `wh` swarm)

After writing, say where it saved and offer to produce the companion `overview.md`.
