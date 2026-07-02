# Vynel — memory index

Project-local working memory. **Rule (Chad):** this index holds only what is **ACTIVE**. When a thing
is done, it moves to `.claude/STATE.md` and gets **removed from this index** — don't let completed
work pile up here. One line + link per memory `.md` in this directory.

## Active
- **✅ Vertical slice BLESSED** by Chad ("exactly what we need"). Squash (`6740f81`) + relocation
  (`481ab3e`) done, green, pushed, re-verified. **knowledge is the TEMPLATE** for future modules
  (`packages/<feature>/{schema,repositories,+logic}`). Full record in `.claude/STATE.md`.
- **✅ `local-api` rename DONE + green** (`apps/api`→`apps/local-api`, `@vynel/api`→`@vynel/local-api`) — this
  api always runs local; the server-level api comes later as a separate app. **CLI decision RESOLVED:** keep
  it over the api for now; the vertical slice already preserves the future db-direct option. See STATE.
- **⏭ NEXT = continue the mission** (Chad: "once this message is done we continue to mission"): knowledge
  **Stage-2** → **workspace → provider → memory**.
- **Phase-2 Postgres reference captured** (from letterman) → `docs/module-notes/postgres-phase2.md`. TL;DR:
  good PG *plumbing* patterns (pooled/direct URL split, `prepare:false`, graceful close, extension DDL in
  `0000`); **nothing** for pgvector/tsvector (deferred there — plan FTS/vec from PG docs). Not actionable until
  Phase 2.

## Resume anchors (where the full state lives — not memories)
- `.claude/STATE.md` — current position; completed work lands here.
- `docs/scaffold.md` — as-built structure + the architecture deep-dive (§3) + web-check (§3.5).
- `.claude/ceo/memory/autopilot-mission.md` — the overnight autopilot log.
