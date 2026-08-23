# 2026-08-24 — Session surfaces night run (Kafi, overnight autonomy)

Four asks in one run: the Sessions list in the tree-row language, the task panel's sessions box
listing only the workspace's CHILD sessions (name + icon), the WORKING edge rail retired, and
Phases/Features into the Utils menu above Plans/Tasks.

## What landed

- **`chat_sessions.icon`** (migration 0053, additive) + a curated 30-name vocabulary in
  `@vynel/contracts/chat/session-icons` (semantic names — `mail`, `bug`, `rocket` — mapped to
  Phosphor on the web side; unknown → monogram, so the vocabulary can grow without breaking old
  clients). `create_session` takes `icon` as a `z.enum`; the birth write stamps it beside the
  name in `recordSpawnedSessionSegment`.
- **The fold resolves icon from the SAME segment as the title** (`fold-session-chains.ts`) — the
  identity pair can never disagree across a pressure swap. Copy-forward was the rejected
  alternative (a later re-icon of a head segment would not propagate).
- **SessionIconBadge** = the one home for "the session's face" (18px square, icon-or-monogram over
  the name-derived accent), worn by SessionRow and the task panel's rows.
- **The sessions box** now filters through the overview to `scope === 'spawned' | 'agent'` —
  discovered on the way: `matchTurnToIdentity({kind:'workspace'})` deliberately matches only the
  room's OWN thread (`primarySessionId === null`), which is why the old box showed the primary
  and missed the children. The box needed raw scope-turn matching (`scopeTurns`) + the entry-side
  child filter; the live card / interrupt keep the old identity match.
- **WorkingRail deleted** — but NOT `use-working-rail.ts`: the Display's `buildingCount`
  (`use-display-status.ts`) folds working identities through it. The composable's header now says
  the Display is its consumer.
- **Phases/Features sections**: web-only work — routes, SDK namespaces and contracts already
  existed. Workspace-only (the Apps shape: `workspaceId` prop, hidden from the global menu via
  `GLOBAL_HIDDEN_SECTION_IDS`, excluded in Global Customize). Create/edit go through a dialog
  because descriptions are big-form (50k) and the LIST carries only a preview — the edit dialog
  fetches the full text and fills ONCE per open.

## The learning worth keeping

**`reconcile()` in the customize codec used to append catalog-new sections at the END, ungrouped**
— every existing install would have gotten Phases/Features below Marketplace, defeating "on top of
Plans/Tasks". It now slots a catalog-new id in before its first catalog successor present in the
stored entries, with its catalog group (degrading to standalone only if the scope deleted that
group). The user's own ordering is never reshuffled — new ids only place relative to their catalog
neighbours.

Also: the customize test pins the catalog SIZE (`entry-row` count 17 → 19) — every catalog add
bumps it; the comment chain in `workspace-customize-section.test.ts` is the log.

## Part 2 (same night) — the sessions box missed a real child + the Nodes truth pass

**The bug the user screenshotted** ("Uncommitted work check" running, box says 0): the two doors
into one child DISAGREE on the wire. `run-task-job.ts`'s session-target rule announces a
delegated child turn as `scopeKind: 'global'` with NO workspaceId (a comment from before
children could be workspace-grounded), while the interactive session-turn stream announces the
same child under its grounding workspace. Any `scopeKind` filter is therefore wrong for one of
the doors. Fix: the box places a turn by its RESOLVED overview entry (`scope` +
`workspaceId` on the session row — the one truth), never the frame's area stamp. Verified live
through the full lifecycle (child working → listed with icon; child done, primary working →
excluded). **Follow-up worth a deliberate decision:** should `run-task-job` stamp the child's
real workspace on the frame? It would change global-family presence semantics — left alone
tonight, recorded here.

**Nodes view (`.tmp/fix-node`)**: the centre orb IS a conversation now. Fleet: core = the
global primary (wears `globalStatus` via a new `setCoreStatus`, click = global chat), and the
voice thread finally draws — the `voice` ref kind recorded for this exact pass — as a `role:
"moon"` SceneNode riding a tight first orbit in every layout (ring placement now walks
`ringIndexBySlot` so a moon never leaves a gap in the ring). Project: "The build" satellite
DELETED — the centre is the primary (room status, chat click); its segments are deliberately
unmapped in `projectMessages`, because an unmapped endpoint anchors at the core, which is where
the primary now lives (the both-null rule keeps its self-chatter off the stage). Fleet dots wear
the workspace's customized image (canvas `Image` cache + cover-fit clip; initials until load).

Flake fixed on the way: `use-display-toggle.test.ts`'s lazy-route `vi.waitFor` got a 10s budget
— under the full suite + dev servers the lazy import alone blew the 1s default (the only red in
three otherwise-green full runs).
