# Persona-sessions arc — morning report (2026-08-04, overnight session)

**TL;DR: the whole arc is shipped — all 19 moves (A1–A10 backend, B1–B8 frontend), each
code-reviewed with fixes applied, each green on targeted tests, each committed and pushed.**
874 tests green across contracts + ui + local-web (604 in local-web alone, up from ~530 at the
arc's start). The full `pnpm test` gate was deliberately NOT auto-run (your CPU rule) — run it
this morning before or alongside the smoke.

Your vision is now real end-to-end: agents are **colleagues** (one continuing session each, with
persona + memory), the lifecycle is **model-spoken** (ack → updates → one final report, no
harvest), and liveness is **visible + durable** (persona cards in the thread, a live pane you can
type into, a Background overview, all rebuilt from the DB after refresh/restart).

---

## What shipped tonight (the frontend view moves; B1–B4 plumbing landed earlier)

| Commit | Move |
|---|---|
| `d231c15` | **B5 — PersonaLiveCard**: each in-flight task renders as a person at the thread's live edge — avatar, queued/working state, "acknowledged" badge (threadId match), current-step narration + recent steps, elapsed, Watch/Stop. Cap 4 + "+N more running". |
| `f90c6c1` | **B6 — Live session pane with direct send**: the panel's session nodes open the REAL conversation (transcript + live overlay + composer; sends queue mid-turn). A mid-turn compaction swap no longer freezes the view — it follows onto the fresh head with a quiet note. Agent colleagues stay view-only there ("@mention them in chat") — the route widening is a recorded follow-up. Chips clicked inside the panel now STACK (Back walks Trace → Session → Agent all the way up). |
| `a0d56d9` | **B5 review fixes**: workspace threads show only THEIR tasks' cards (the old banner's scope rule); the acked badge ignores the parent's own routed-task stamp; the narration crossfade CSS actually applies now (scoped copies never did); ProcessingBanner reduced to the origin note (dead chip code deleted). |
| `4f677f4` | **B7 — Background overview**: Claude-desktop-style roster of everything running/queued, grouped by persona, with narration/elapsed/origin, Watch + Stop per task. Opens from the title-bar presence button, Home's "See all", or the thread's "+N more" line. Built as a monitor-panel BASE node — every drill pushes, Back returns to the overview. Seeds from the durable `GET /activity/running` so a fresh window shows the truth before the stream replays. |
| `a7f16d0` | **B8 — Origin rendering**: persona rows wear their own face (image or accent monogram) in the author line; interim **Updates** get their own badge + "View update" door + dialog title (never mistakable for the final report); the channel "via X" badge derives from the one contracts reading; session panes' composer says "→ <persona>". |

Backend (A1–A10) was already in from the earlier session: colleague sessions
(`primary_sessions` scope 'agent'), the mention path resuming them, HARVEST RETIRED,
`send_message` kinds task/report/update with acknowledge-first steers, `chat_messages.threadId`,
restart failure parity, the durable `session_turns` envelope + enriched feed +
`GET /activity/running`, the three legacy comms tools deleted, `deriveMessageOrigin`.

## A real bug the reviewer caught tonight (fixed in B8, repairs B5/B7 retroactively)

`ResolvedPersona.accentVar` carried a full `var(--ws-N)` reference while every consumer wrapped
it in `var()` again — invalid CSS, so **every persona accent tint (cards, roster, author
monograms) silently rendered transparent**. The green tests used unrepresentative fixtures. The
convention is now the bare property name (`--ws-N`), documented on the type and pinned by a
resolver→row contract test. You should SEE tinted monogram chips this morning — if they're
gray/transparent, that's a regression.

## The morning smoke (what tests can't prove — we do this together)

Start the API + web dev servers, then walk the plan's §Verification list:

1. **The feel**: delegate something from Global ("Build X on workspace Y") — persona cards at
   the thread edge instead of the old banner chips. Do they feel like people working?
2. **The spoken lifecycle**: the child's ack ("Received — …") lands within seconds as an
   **Update**-badged row; the final result arrives as a **Report** row; the card settles away.
   Check the dialog titles ("Update from…" vs "Report from…").
3. **Click into a running session and TALK to it**: Watch on a card → the trace → drill to the
   session (or open one from Sessions) — live streaming, then type into it mid-turn (your send
   should queue and fire when the turn settles). The composer shows "→ <name>".
4. **The Background overview**: fire 2–3 delegations, click the title-bar presence dot —
   groups per persona, queued under working, Stop works, Back always returns to the roster.
5. **Refresh mid-delegation**: F5 while a task runs — the roster and cards rebuild from the DB
   (the durable seed), not blank.
6. **A colleague remembers**: @mention an agent twice (second mention referencing the first
   task) — same colleague, memory holds, both conversations visible in its session.
7. **The compaction follow** (rare, only if a long session swaps): an open session view should
   follow onto the fresh segment with the "conversation continued" note instead of freezing.

Also run the full gate this morning: `pnpm test` (typecheck + parity + full vitest).

## Known-accepted residuals (documented in docs/module-notes/session-personas.md)

- The panel header's live dot keys on the OPENED segment id — after a mid-watch chain swap the
  body follows the head while the dot may idle (self-heals on reopen; briefly two streams).
- SessionsView's active-row highlight stays on the opened id after a swap (cosmetic).
- A superseded view-only part holds an idle registry watch (one code path, refCount-bounded).
- Colleague direct-send via `POST /sessions/:id/turn` is DEFERRED (needs MCP-set parity — the
  delegated interactive/routing set, not the plain background set); the pane says "@mention".
- Escape while typing in the panel composer may close the panel (AppComposer doesn't claim the
  key) — watch for it in smoke; one-line fix if it annoys.

## Deferred follow-ups on the books (module notes hold the details)

Global colleagues invisible in SessionsView's global scope · liveness-scope unification
(mention runs announce workspace-scoped, task-branch runs global) · leaf machinery removal ·
`record-pushed-report-message` deletion · ActivityMonitorPanel ~350 lines — extract a
per-node-kind header derivation next time it's touched.

## Where everything lives

- Resume file: `.claude/STATE.md` (arc marked COMPLETE, this report linked).
- Arc decisions + notes: `docs/module-notes/session-personas.md`.
- Plan: `C:\Users\KLONE\.claude\plans\quirky-painting-fairy.md`.
- CHANGELOG.md: user-facing entries added under [Unreleased].

Good night — see you at the smoke. 🌙
