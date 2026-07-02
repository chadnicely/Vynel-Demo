# NEXT ACTION: the relocation SPIKE (squash is DONE)

## ✅ Squash — DONE (green, proven, uncommitted — awaiting Chad's commit)
The 39 migrations → one `0000_baseline.sql`, **proven semantically identical** to the old chain via a
fingerprint oracle (30 tables, 5 virtual, 26 shadow, 9 triggers — every column/FK/index). Test swap:
`migrate-knowledge-sources.test.ts` → `migrate-baseline.test.ts`. Gate green: 86 files / 524 tests. Full
detail in `.claude/STATE.md` (⏵ SQUASH — DONE). **Prompt Chad to commit before starting the spike** (so its
revert can't touch the squash — advisor's sequencing).

## ▶ The spike — what remains (the REAL open decision)
Relocate knowledge's `schema/` + `repositories/` from `@vynel/db` into `packages/knowledge/` (vertical
slice), rewire imports, run the gate.

**The advisor's correction (do NOT forget):** a green spike proves vertical-slice is **VIABLE, not that it
WINS.** drizzle-kit generating schema across feature packages is almost certainly fine (the config is a path
array; Drizzle FKs resolve at the object level `() => users.id`, not by file location). The real friction is
**TS import rewiring** (grep every `@vynel/db` importer of knowledge schema/repos first) — and the migration
*apparatus* (one drizzle config, one migrations folder, one journal, one parity guard — the guard hardcodes
`packages/db/src/schema` as its walk root) **stays in the kernel regardless**. So:
- **Green ≠ "vertical slice wins."** It means "viable; here's what stays centralized."
- Deliverable = a **side-by-side** (both trees + residual centralization + the legibility trade) → **Chad
  decides.** The test settles *can we*; Chad settles *should we* (his legibility call, per "ASK on real forks").
- Revert the **relocation only** if it fights the tool or the rewire is ugly — the squash survives.

## After the spike
If vertical-slice wins → knowledge is the **template**; **fan out agents** for small modules (memory /
schedules / capabilities / …), **big modules step-by-step** with Chad. Still pending regardless: knowledge
**Stage-2** (add-directory route + `add_to_knowledge` MCP tool + CLI — needs a `FileWatcherService` in the api
DI), then the mission **workspace → provider → memory** (session together).

## Durable state
Knowledge backend: `bbb87bc` · `65b3025` · docs `d859256` / `5e1fa6b`. The squash is on disk **uncommitted**
(green + fingerprint-proven). **Agents stall on long runs (>~9 min) — keep agent tasks small or do it directly.**
