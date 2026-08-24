# 2026-08-25 — The base+kind identity stack

## What moved

Kafi's model, landed in one arc: **every session's identity = one BASE + its KIND file**, composed
by the new `composeSessionInstruction(kind, { voice, agentName })` in
`@vynel/instructions/session-instructions` — one home for the order (base first, kind second;
steers and feature sections join after, at the caller).

- **`base.md`** (new) — the shared text base: the operating rules that were duplicated across
  `global-root.md`/`workspace-agent.md` (plain language, ask-don't-invent, approval card, real
  schedules, "Vynel, never the underlying runtime", the duty-book/whoami pointer) plus a NEW
  reply-format section (lead with the answer, short paragraphs, restrained structure).
- **`voice-base.md`** (new) — REPLACES the base on voice turns. Absorbs the old `voice-turn.md`
  modifier verbatim (spoken format, the load-bearing "no `speak` tool" fact, banned fillers) and
  restates the ground rules spoken-sized. `voice-turn.md` deleted; `voice-turn-marker.md` (the
  per-message recency restatement) untouched.
- **`workspace-agent.md` → `workspace-manager.md`** — Kafi's correction: the workspace primary IS
  the manager (its duty book was already `duty-workspace-manager`). The kind file now frames it:
  runs the work itself or hands slices to child sessions, children report to it, and a task sent
  to a child goes **with clear instructions** (the third layer: base + kind + the task steer).
- **`spawned-session.md`** / **`agent-colleague.md`** (new) — children were identity-less
  (steer-only). Spawned children and agent colleagues now open with base + their kind;
  `composeAgentColleaguePrompt` renders `{{agentName}}` from the md (the render-marker precedent,
  fail-loud on an unfilled placeholder) and appends the DB persona.
- **Routed turns carry the identity too** — `delegateToWorkspaceRoot` / `delegateToSpawnedSession`
  prepend the stack before the routed steer, closing the documented asymmetry (the workspace
  primary used to speak with two different identities depending on which door the turn came
  through). `whoami`/`checkpoint` already ride the background toolset, so children can read their
  own identity as well.

## Decisions

1. **Two parallel bases, not base+modifier** (Kafi): output format is base material, and a voice
   turn must never get prose rules it then has to un-learn. Cost accepted eyes-open: the shared
   disciplines exist in both files, phrased per medium — a colocated **alignment test** pins the
   core rules to BOTH so an edit to one cannot silently drop what the other states.
2. **Slug naming is kind-level content.** `resolve-whoami-report.test` pins `duty-global-root`
   inside the global-root prompt — the generic duty-book mechanism moved to base, but the kind
   file keeps naming its own book.
3. **The leaf-tier fork stays untouched.** This arc's consumers (session spine + apps) already
   import the package legally; the feature standing-line pull (asks/desktop/ssh/… prompts into
   markdown) remains a separate decision (injection vs shared-tier subpaths).

## Gate

`pnpm test` GREEN twice (slice 1, then the manager/children pass): 1023 files / 6977 tests,
typecheck + parity included.

## Owed / deferred

- Interactive `streams/session-turn.ts` (a user typing directly into a child session) composes no
  identity yet — needs kind resolution from the session row; small follow-up slice.
- Doc refresh: `.claude/docs/instructions/` book (predates all three md homes),
  `.claude/docs/session/structure.md` + `docs/module-notes/voice-realtime.md` still mention
  `voice-turn.md`; `docs/module-notes/instructions-notebook.md` still reads "PLANNED".
- Wording passes on the md files are expected and cheap — that is the point of the design
  ("make the base ready, we will tweak instructions later" — Kafi).
- Notebooks arc later: the duty-book bindings (`duty-global-root`, `duty-workspace-manager`,
  `duty-spawned-session`, `duty-agent-colleague`) still await their books on the verified shelf.