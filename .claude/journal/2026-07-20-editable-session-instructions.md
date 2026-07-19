# 2026-07-20 — Editable session-instruction markdown

## What moved

The three always-on session-identity prompts left `@vynel/session/runtime` as TypeScript string
literals and became editable markdown in the `@vynel/instructions` leaf:
`session-instructions/{global-root,workspace-agent,voice-turn}.md`, each file body IS the prompt.
A new loader (`src/session-instructions/load-session-instruction.ts` — `readFileSync` + per-id
cache + fail-loud) is reached through a dedicated SDK-free subpath
`@vynel/instructions/session-instructions`, so `@vynel/session` (spine → leaf, legal downward edge)
pulls only the filesystem loader, never the notebook MCP descriptor's `claude-agent-sdk` builder
graph. Consumers `compose-session-capabilities.ts` (workspace-agent) and `run-global-root-turn-core.ts`
(global-root + voice-turn) now call the loader; the three old constant files were deleted, and the
load-bearing routing-tool guard moved into the loader's colocated test.

This is Chad's "at first" step of the deferred always-on-instructions arc: **content editability
first**, before the DB-backed + in-app-editing version. Scope was deliberately the session-identity
prompts only — the per-feature standing lines (notebook/tasks/ask/desktop) stay with their features,
because a feature owns its own prompt and its line is coupled to whether its tool is even attached.

## Precedents reused (no new pattern invented)

- `notebooks/verified-notebooks.ts` — repo-shipped `.md` read from disk at package root
  (`resolve(here, '../../session-instructions')` resolves for both `src/` and `dist/`), cached for
  the process lifetime, fail-loud on a missing/empty file.
- `@vynel/asks/mcp` — the SDK-free-subpath split that keeps the heavy SDK graph out of a lean
  consumer.

## Learnings

- **A byte-identical move needs a check the gate can't run.** Every affected test is a substring
  match or loader-relative (`toContain(loadSessionInstruction(...))` — both sides use the loader, so
  whitespace is tautological). Nothing compared against the *old* text, so CRLF drift on a Windows
  `Write` would have passed the suite silently. Confirmed clean out-of-band: files are LF and
  `.gitattributes` enforces `eol=lf`; the reviewer separately reconstructed the deleted constants
  from HEAD and proved all three `===` identical.
- **A move can make a doc false, not just stale.** `docs/module-notes/instructions-notebook.md` said
  the identity prompts "stay LOAD-BEARING and hardcoded" — this change un-hardcoded them, so that
  line moved with the code (distinct from the as-built path refs in `.claude/docs/`, a fair defer).
- **Cache = restart, not next-turn.** The process-lifetime cache (verified-notebooks parity) means a
  live edit applies on app restart; the first README draft over-promised hot-reload — reworded.

## Gate

`pnpm test` GREEN — 506 files / 2678 tests (typecheck + parity + vitest); `pnpm lint` clean on the
touched files (repo-wide lint breakage is a pre-existing `scripts/` config issue). code-reviewer:
COMPLETE + behavior-neutral, 1 should-fix (README wording) folded.

## Follow-ups (recorded, not done)

- Refresh the as-built docs still pointing at the deleted paths: `.claude/docs/session/structure.md`,
  `docs/module-notes/session.md`.
- The bigger deferred arc: DB-backed + in-app editing of these same prompts (the `mode: 'always'`
  column on `instruction_documents` is already reserved for it).
