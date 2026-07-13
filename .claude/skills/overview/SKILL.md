---
name: overview
description: >
  The OVERVIEW view of a Vynel module (package / app / platform group) — what it is and does,
  in plain language: purpose, capabilities, responsibilities, vocabulary, rules, lifecycle.
  No code, no file paths. One of the two files of the as-built docs book (`.claude/docs/`).
  Also used by the `wh` agent as the playbook for the OVERVIEW view.
allowed-tools: Read, Grep, Glob, Bash, Write
argument-hint: <unit> [output-dir]
---

Produce the **OVERVIEW** view of `$1` — the conceptual half of Vynel's as-built module docs.

`$1` is the unit to document (a package under `packages/`, an app under `apps/`, or a platform
grouping). `$2`, if given, is the output directory; otherwise default to `.claude/docs/$1/`.

This file is one half of a fixed two-file set: **`overview.md`** (this view — the idea) and
**`structure.md`** (the code map, written separately). Stay strictly on your side of that line:
if you catch yourself naming a file, function, table column, or route path, stop — that belongs
in `structure.md`.

## Style reference (read one before writing)

The format is inherited from the v1 doc book. Read ONE exemplar for tone and shape — e.g.
`E:\KAFI\WORKSPACE\v2\vynel\.claude\docs\memory\overview.md` (any sibling works). **Style only:
never copy v1 content — v1 is a different codebase. Every claim you write must come from the
code in THIS repo.**

## Step 1 — Locate and understand first

Read the unit's real code in this repo (`packages/$1/` or `apps/$1/`) before writing a word:
its schema, operations, routes it feeds, events it publishes, MCP descriptor if any. Check
`docs/module-notes/$1.md` for design intent, but the code on disk wins. Do not invent
responsibilities the code doesn't support.

## Step 2 — Write `<output-dir>/overview.md`

Open with:

```
# <Unit> — Overview

> <one-sentence essence of the module, written for a human>
>
> **Status:** shipped | partial | stub · **Depends on:** <linked sibling overviews> · **Code map:** [structure.md](./structure.md)
```

Then these sections (omit any that genuinely don't apply — the list is a menu, not a mandate):

1. **Purpose** — what this module lets Vynel do and why it exists; what makes it a product
   surface vs plumbing, if that distinction is real here.
2. **What it can do** — capability bullets, user/agent-visible verbs first, `*(background)*`
   work last.
3. **Responsibilities** — **Owns** (one tight paragraph) and **Does not own** (bulleted, each
   naming the module that DOES own it, linked).
4. **Concepts & vocabulary** — table of the unit's terms, one line each (its ubiquitous language).
5. **Rules & invariants** — the "always true" statements in plain English, bolded lead phrases.
6. **Lifecycle** — if the central concept moves through states, a `mermaid stateDiagram-v2`.
7. **Where it sits in the bigger picture** — one prose paragraph placing it among the other
   modules, with relative links to their `overview.md`.

Close with the provenance footer (use today's real date via `date`):

```
---
*Mapped from the code on disk, <YYYY-MM-DD>. If you change this module, update this file and [structure.md](./structure.md).*
```

## Rules

- Plain language a new teammate — or Claude in a fresh session — can follow without the repo open.
- Zero file paths, zero function/class names, zero SQL. Table/event *concepts* are fine ("four
  lifecycle events"), their identifiers are not.
- Faithful to the code on disk. If the code contradicts stated intent (module notes, old docs),
  say so plainly rather than papering over it.
- Relative links to sibling module docs may point at folders not yet written — that's fine,
  they mark the book's shape.
- Every sentence earns its place.

## If run directly (not by the `wh` swarm)

After writing, say where it saved and offer to produce the companion `structure.md`.
