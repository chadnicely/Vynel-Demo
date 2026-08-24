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

## Follow-up slice (same day): direct child turns + the plain kind

`streams/session-turn.ts` now composes the identity too — scope `spawned` → base+spawned-session,
scope `agent` → `resolveColleagueAgent` (the existing one home) → `composeAgentColleaguePrompt`
(now takes `{ voice }` and rides the voice base on spoken turns). **Found and fixed a real hole:**
a user typing directly at a colleague got NO persona at all — it rode only delegated turns; a
colleague whose agent row is gone falls back to the child identity rather than failing the turn
(guarded by a new persona-on-direct-turn test). `workspace-session.md` shipped CONTENT-FIRST for
the duty-book `plain` kind (no live door composes it yet — the binding-before-content precedent).
Gate green again (1023 files / 6979 tests).

## Follow-up (same day): step narration + the transcript fold

Kafi's output-format directive: the base now mandates the STEP-NARRATION shape — ONE short line in
the user's words before each batch of tool calls, no text between the calls, a new line per step —
**guarded as UI-load-bearing** (the collapse depends on it, like routing depends on the tool
names). Plus easy-words/explain-less/examples-in-markdown. The collapse itself needed NO wire
change: `toolCallsByMessageId` / `segment.toolCalls` already batch per assistant message, so the
step line IS the boundary. `ToolCallList.vue` (one home — ThreadStream + LiveTurn both render it →
every session view) folds the batch behind "N tool calls · <hint>" (hint = running call while
live, incl. an Agent's ticker; else the latest call; approved by Kafi: count + one-liner,
expandable); a BLOCKED call auto-opens its batch. Gotcha for next time: ToolCallList ticker/watch
tests live in **AgentActivityPane.test.ts** — a scoped run of ToolCallList.test.ts alone misses
them (found by the full gate, red once, fixed by expanding before card-level asserts).

Round 2 (Kafi's screenshots): the per-message fold produced MANY "1 tool call" rows — the SDK
persists one message per provider message, so a heredoc-heavy run fragments. Fix =
`mergeToolOnlyBatches` (packages/ui/tool-cards, pure, one home for BOTH renderers): a text-less
tool-carrying row folds its calls into the nearest assistant text row above (user rows /
continuation anchors reset; a tool-opening row anchors itself — two existing tests pin that;
`hasText` must be assistant-only or a USER row becomes the holder — the round's one real bug). The
folded line became the Claude-Desktop summary: `summarizeToolCallBatch` → "Ran 4 commands, edited
pricing.ts" + aggregated ±diff chip; the hint now names only a RUNNING call. Emptied carrier rows
render nothing.

## Round 3 (same day): the operating model + the journal pointer

Kafi's full system model landed its first two implementation slices (`1b80d848` + `13dc0e6f`):

- **Kind files carry the manager/child flow.** Manager: stay with the user; one dedicated child
  per area; tasks sent WITH instructions and tracked; children in worktrees, never main; **the
  manager merges and removes the worktree — never another child**; small asks skip ceremony.
  Child: context first → task → plan → steps → test-first → **FRESH context-less review agent**
  gate → report; small tasks skip the ceremony. Guards pin merge/worktree/reviewer phrases. The
  deeper pipeline is duty-book/notebook material — Kafi writes those later (incl. the
  new-workspace research notebook).
- **Journal = the clickable timeline.** `commit_ref` column (migration 0054, drizzle-generated);
  attribution server-stamped from the turn-session header (`resolveOwnedTurnSessionId` EXTRACTED
  from tasks/index.ts into turn-session-header.ts — one home at its second consumer); responses
  resolve `sessionTitle`; the journal UI wears a session pointer chip (opens the conversation
  sidebar — the tasks-panel door) + a commit chip; `add_journal_entry` takes `commit`; the prompt
  section teaches started/completed/fix entries. JournalSection's mount gained pinia (the sidebar
  store) — its test harness too.
- The system model's other legs already exist: memory (standing facts), knowledge (user
  docs/research), features (the catalog a feature manager maintains). The worktree STATE tools
  stay the github-connection Slice 4 arc.

## Owed / deferred
- Doc refresh: `.claude/docs/instructions/` book (predates all three md homes),
  `.claude/docs/session/structure.md` + `docs/module-notes/voice-realtime.md` still mention
  `voice-turn.md`; `docs/module-notes/instructions-notebook.md` still reads "PLANNED".
- Wording passes on the md files are expected and cheap — that is the point of the design
  ("make the base ready, we will tweak instructions later" — Kafi).
- Notebooks arc later: the duty-book bindings (`duty-global-root`, `duty-workspace-manager`,
  `duty-spawned-session`, `duty-agent-colleague`) still await their books on the verified shelf.