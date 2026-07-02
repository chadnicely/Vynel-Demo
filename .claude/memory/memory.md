# Vynel — memory index

Project-local working memory. **Rule (Chad):** this index holds only what is **ACTIVE**. When a thing
is done, it moves to `.claude/STATE.md` and gets **removed from this index** — don't let completed
work pile up here. One line + link per memory `.md` in this directory.

## Active
- **✅ Vertical slice BLESSED** by Chad ("exactly what we need"). Squash (`6740f81`) + relocation
  (`481ab3e`) done, green, pushed, re-verified. **knowledge is the TEMPLATE** for future modules
  (`packages/<feature>/{schema,repositories,+logic}`). Full record in `.claude/STATE.md`.
- **⏵ AWAITING Chad's go: CLI db-direct vs. continue mission.** Chad wants the CLI to run on **just a db
  connection** (no api) — the vertical-slice payoff. NOT executed (reverses the CLI-over-SDK "3 directions"
  work + an open migrations-on-open design Q that's his). See STATE "⏵ CLI DIRECTION". When he's back: rewire
  CLI db-direct, OR continue the mission — knowledge **Stage-2** → **workspace → provider → memory**.

## Resume anchors (where the full state lives — not memories)
- `.claude/STATE.md` — current position; completed work lands here.
- `docs/scaffold.md` — as-built structure + the architecture deep-dive (§3) + web-check (§3.5).
- `.claude/ceo/memory/autopilot-mission.md` — the overnight autopilot log.
