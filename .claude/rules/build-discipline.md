# Build discipline — per-move cadence

*How* each code move happens. (Code/style rules live in `CLAUDE.md`; the mindset + the why lives in
`.claude/ceo/soul.md`.)

## The unit of work is ONE module, moved small-by-small

A "move" pulls one package — or the smallest vertical slice needed to make it testable — from the old
repo into KLONE, gets it green, then improves it. **Never pull the whole repo at once.**

## Start each module with Chad's advice

Chad knows the gaps in the old implementation and advises **per module**. Before Gate 1, capture his
advice + the known old-repo gaps in **`docs/module-notes/<module>.md`**. The module is pulled to
satisfy them: **land it faithfully and green first, then improve to close the gaps** — a gap that
needs a schema change is planned deliberately, never slipped in on red.

## The three gates

1. **Think before scaffolding.** Surface the shape of the move: what's pulled, its dependencies, the
   import rewires. Pause only on a genuine fork; otherwise proceed.
2. **Green before improving.** Land the module *faithfully* first (`pnpm test` green), **then**
   refactor / dedupe / tighten. Never improve on red.
3. **Verify before shipping.** `code-reviewer` on the diff + the green gate. Then prompt Chad to
   commit + journal.

## The gate is `pnpm test`

= `turbo run typecheck` + schema/MCP parity + `vitest run`. Never bare `vitest`. **Never commit on
red.** (For packages-only pulls before `scripts/` + api routes land, the gate is typecheck + vitest;
parity activates once those are in.)

## On every move, run the CEO checks (`soul.md`)

Direction still right? · Any duplication to extract into a shared package **now**? ·
Smallest-correct-thing? · Rewire any `@vynel/core` re-export imports to direct package imports as you
pull. · Record the learning in `.claude/journal/`.

## Commits

Conventional commits (`feat` / `fix` / `refactor` / `chore` / `docs` / `test`), subject < 72 chars,
lowercase, no period. One logical move per commit. **Prompt Chad — don't auto-commit.**
