# Vynel — memory index

Project-local working memory. **Rule (Chad):** this index holds only what is **ACTIVE**. When a thing
is done, it moves to `.claude/STATE.md` and gets **removed from this index** — don't let completed
work pile up here. One line + link per memory `.md` in this directory.

## Active
- **Awaiting Chad's bless on the vertical slice.** Squash (`6740f81`) + vertical-slice relocation
  (`481ab3e`) both DONE, green, committed + pushed — full record in `.claude/STATE.md`. The feature-shape
  fork is Chad's legibility call; I committed my recommendation (KEEP) for durability. He blesses (do
  nothing) or reverts (`git reset --hard 6740f81 && git push --force origin main`). **If blessed →
  knowledge is the template; fan out agents for small modules.**
- **Mission continues:** knowledge **Stage-2** (add-directory route + `add_to_knowledge` MCP tool + CLI;
  needs `FileWatcherService` in the api DI) → **workspace → provider → memory** (Chad's order). See STATE.

## Resume anchors (where the full state lives — not memories)
- `.claude/STATE.md` — current position; completed work lands here.
- `docs/scaffold.md` — as-built structure + the architecture deep-dive (§3) + web-check (§3.5).
- `.claude/ceo/memory/autopilot-mission.md` — the overnight autopilot log.
