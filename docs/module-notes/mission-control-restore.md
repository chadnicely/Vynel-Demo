# Mission-control restore — pulling Chad's branch onto main (module notes)

**Kafi's ask (2026-08-26):** put `origin/chad/mission-control-restore` in a worktree, compare
Chad's last commits with main, review his UI first, and plan the pull onto main.

**The branch.** Three commits by Chad (built with Claude Opus in his own session), cut from
`fe55c557` (0.3.6, 2026-08-24). Main is **71 commits past the fork** — it is a fork, not a queue.

| Commit | What Chad says it does | Files |
|---|---|---|
| `68f5565f` feat(onboarding+workspaces) | one hidden projects folder, his wizard order, "Which project?" picker, 4-step setup + Connect a brain + GitHub, fireworks | 108 (+20.5k / −2.7k — 14.8k of it two migration snapshots, 1.3k generated SDK) |
| `ac06741b` feat(chat) | his TasksPanel + LiveTurn folded line restored; queue keyed by conversation; mode = standing preference; mode change reaches the running turn; Stop interrupts mid-tool; "Finish setting up" wired | 73 (+4.3k / −1.8k) |
| `216e3cf2` fix(tasks) | ABORT calls `chat.interruptSession` instead of emitting into nothing | 2 |

167 files; **52 touched on both sides** since the fork; **6 deleted** by his branch (the three
retired onboarding steps + their handlers — main deleted the same ones, no regression there).

**Worktree:** `.claude/worktrees/mission-control-restore` (branch `chad/mission-control-restore`,
band **18970**: engine 18972 · voice 18973 · web 18974, own DB). Its `.env` has
`VYNEL_FIRST_LAUNCH_GATE_ENABLED=1` (flipped from the dev default so the first-launch flow shows).
Its own design note is `docs/module-notes/onboarding-trim.md` **on his branch** — Chad's verbatim
direction, and it names the two decisions of Kafi's it reverses. Read it before deciding D1–D3.

---

## Verdict

1. **His UI is good and mostly pullable as drawn.** Copy, layout and flow of every screen below
   read well on a fresh install; the two prototype screens are real reads of the existing sign-ins,
   not decoration. Keep his labels; rebuild the plumbing ([[boss-design-branch-pulls]]).
2. **Never merge, never copy a file over main's.** Copied whole, his files erase main's post-fork
   work in five places (§5) and `build-claude-sdk-options.ts` would bring the `claude_code` preset,
   the 30 native tools and the hidden auto-memory back.
3. **Four product decisions block most of the pull** (§3). Everything that does not depend on them
   is Slice 0 and can start now.
4. **Schema creep:** `users.projectsDirectory` + `workspaces.setupCompletedAt`, shipped as
   migrations **0053/0054 — colliding with main's 0053/0054 (0055 already exists)**. Regenerate on
   main via drizzle; never copy his SQL, snapshots or `_journal.json`
   ([[drizzle-generate-never-handwrite-migrations]]).
5. **One open bug from the live walk:** the engine froze during step 3 twice (§6). Not yet pinned
   to his code — must be understood before any smoke sign-off on this flow.

---

## 1. UI walk — what Chad built (live on band 18970, screenshots in the session scratchpad)

| Screen | What the user sees | Call |
|---|---|---|
| **Step 1 · Hello — welcome to Vynel** | card chrome unchanged (VYNEL mark, STEP 1 OF 6, dots, "Start over"); lede "Vynel builds software with you, then looks after it… About three minutes."; three promise cards (projects stay where they are · builds with your own AI account · nothing is ever lost); **Let's go** | keep copy |
| **Step 2 · Your profile** | main's screen untouched | keep |
| **Step 3 · Name your workspace** | main's copy untouched ("A workspace is a room your assistant works in… **Create workspace**") — but behind it now mints `~/Documents/Vynel/<name>` and **creates no workspace**; nothing named here ever appears in the sidebar | copy contradicts the new meaning — needs Chad's words (D2) |
| **Step 4 · Help Vynel know you** | retitled (test forbids "Claude" in step labels); still asks "What should it help with **in this workspace**?" though no workspace exists; answers become user-level memory | keep; fix the "in this workspace" line |
| **Step 5 · Connect a brain** | "Vynel builds with your own AI account."; Claude card **CONNECTED** + account (real `GET /providers/claude/auth`), Codex / Kimi **NOT YET** greyed; **Use Claude**; not skippable; gate copy "Sign in to Claude to carry on — Vynel can't build without a brain." | keep as drawn |
| **Step 6 · A safe copy on GitHub (Optional)** | lede "…If this computer disappears tomorrow, your work doesn't."; Connected + handle (real `GET /github/connection`) or "One button, one code — no passwords here." + **Connect GitHub**; "No GitHub account? Skip this…"; **Skip for now / Continue** | keep as drawn |
| **Finish, beat 1** | "Congratulations, {name}!" / "Your Vynel account is all set up. Now let's go build the magic." / **Open Vynel**, canvas fireworks behind the card (reduced-motion off) | keep |
| **Finish, beat 2** | "What are we starting with?" / "Either way it ends up on your screen the same." — **Something new** / **Something I already have** (the ONE place the question is asked) | keep |
| **Sidebar** | three headings, always shown, counts flattened over groups: **ACTIVE PROJECTS** (carries + New group / + New workspace), **NOT RUNNING**, **NEEDS SETUP**; fold state remembered per heading; menu groups Toolkit / Utils / Context / Connections **start folded**, choice remembered | keep; two tripwires in §4 |
| **"+" door** | "What are we adding?" / "Nothing you already have is ever moved." → **Start something new** / **Bring in what you have** → "Where is it now?" → **Pull from a folder** / **Create local from a repository**; "Pick one to carry on" | keep as-is (clean, tested) |
| **Which project?** | "Pick the folder your projects live in — or one project folder." → **Choose folder…** opens the OS window; engine answers Found it / Which of these? (tick, "Add 3 projects") / Nothing recognised ("add it anyway"); per-row failures name themselves | keep UI, rebuild the door (§4) |
| **Wizard** | opens on **"What do you want to build?" · Step 1 of 12** (idea first, his order); name asked at screen 9 ("Just a name to start. Vynel makes a folder for it in your workspace…"); no path on screen until Finish (StepDone still prints the minted path) | order rides D2 |
| **Finish setting up** | kicker + "1 of 1"; title = project; four accordion rows — Git Repository ("kafijunior/probe-project — new private repository"), AI Platform (provider + account combos), ENV File ("already in the folder — 2 settings", key names only), The database it already has; **Skip for now / Done — start building** | keep the words; rows 1–3 are decoration today (§4) |
| **Workspace tab + rail** | his TasksPanel: "Nothing running" card, red **■ ABORT** pinned at the top, "All Tasks" compact lines | graft onto main's panel (§4) |

Not walked: the folded live line, the ABORT press and "what you typed while it worked" need a live
turn (a token-spending smoke — Kafi's, from the worktree).

---

## 2. Competing implementations — main moved under him

| Area | Main since the fork | Chad | Call |
|---|---|---|---|
| First launch | `0ea46352` **two steps** (Welcome + profile; NameWorkspace / IdentitySeed / seeding deleted; stale-run self-heal added; DB union keeps all stored kinds) | six steps + Connect a brain + GitHub + fireworks + the door question | **D1** — one contract, cannot be half-pulled |
| Tool-call folding | `0bc70ba0` + `008f4976`: tool batches fold to one line ("Ran 4 commands, edited pricing.ts" + hint + live dot), self-open on a blocked call, merged across messages | the **whole turn** folds to one row (avatar · Claude · newest activity · elapsed); hides the answer typing in, thinking, tool cards **and the Ask card**; opens on click / when the turn ends | **D4** |
| Tasks rail | `2736d77c` phases/features, `e4065663` agent-run cards + session icons, `37a1faac` sessions box + rail retired; main's panel already headlines the in-progress task and interrupts the room's turn on Stop (with confirm) | his 731-line panel: live card copy, "All Tasks" sorted done→live→queued, top ABORT (no confirm), typed lines in the card; dead "Open it" buttons; HALTED state no host can set | graft (§4) |
| Sidebar tree | `37a1faac` / `e2c96e1b` sessions library in the sidebar, `cb4d30db` `TreeStateMark` on the Global row; main still pins Kafi's 2026-08-19 "rows stay put, no NOT RUNNING group" | Active / Not running / Needs setup split + folded groups (reverses the 2026-08-19 call on purpose) | keep his, re-apply as hunks |
| Providers | `ab0edcef` custom system prompt, base toolset, auto-memory off (same file) | `readPermissionMode` seam, `SDK_PERMISSION_MODE`, live `setPermissionMode`, interrupt-before-abort, `canUseTool` bound in every mode | line-disjoint — hand-apply his three hunks |
| Queue / mode | queue still component-scoped (his bug is real on main); `DEFAULT_SESSION_MODE` is already `auto`; new-chat default in localStorage | module-level map keyed by conversation; a pick inside a chat also writes the default | keep both (queue as a Pinia store) |
| Workspaces | untouched except phases/features sections | hidden projects folder, engine-minted folder, OS picker, setup stamp, Finish setting up | **D2 / D3** |

---

## 3. Decisions needed (Kafi, with Chad where product direction reverses)

**Standing rules from Kafi (2026-08-27):** pull by checking functionality, never merge; **never
remove any file-browser functionality** — Chad's "Which project?" screen is built beside the
Explorer-style `FileSystemBrowser`, creating new code or reusing the old, not replacing it; after
each slice, stop and discuss the next.

- **D1 — First launch. DECIDED (Kafi, 2026-08-27): Chad's flow WITHOUT "Name your workspace"** —
  welcome → profile → Help Vynel know you → Connect a brain → GitHub → fireworks → "new or
  existing?" (five steps). Setup creates no folder and no workspace; the door question does.
  Built as Slice 1 on `feature/mission-control-pull` (see the status table). Consequence for D2:
  `users.projectsDirectory` has no setup writer any more — if the hidden-folder model is taken,
  the folder is `~/Documents/Vynel` (or a Settings field), never a setup step.
- **D2 — The hidden projects folder.** `users.projectsDirectory`, set at step 3 and never shown;
  new projects mint `<folder>/<name>` and the wizard asks a NAME only (idea first, name at 9);
  pull-in stays where it sits. This reverses Kafi's 2026-08-23 "the picked folder IS the workspace,
  no child folder minted from the name" ([[new-workspace-wizard-arc]]) for the NEW-project path
  only, and moves the wizard's study/plan one-shots to run from the projects HOME instead of the
  project. Chad's note states the reversal and the why ("show the folder and one of the two
  promises becomes a lie").
- **D3 — The setup stamp.** `workspaces.setupCompletedAt` + the NEEDS SETUP bucket + "Finish
  setting up" on row click. Kafi dropped this column on 2026-08-23 and the 2026-08-15 nodes plan
  says "do not port". Without it, Finish-setup can still exist as a one-shot dialog after a
  pull-in; with it, **every new workspace opens the setup dialog until "Done — start building"**.
- **D4 — Fold the whole live turn?** As coded it hides the answer typing in and any Ask card
  behind one line (only the shell's ApprovalNotifier still surfaces the card). Alternative: keep
  main's per-batch fold and take only his "one line naming the current activity" for the tool
  work, never for text / approvals.
- Smaller, decide during the slice: HALTED/resume (build a real per-project halt or ship ABORT
  alone) · row click cycles the stage (his) vs opens the task view (main) · his purple Nocturne
  palette island vs the app's tokens on his layout · OS dialog through the engine's PowerShell
  (his) vs the desktop shell's `tauri-plugin-dialog` · `read_project_setup` as an agent tool
  (his route is `x-mcp`) · restore main's inline group select in the picker · keep the "+"
  quick-add beside "All Tasks".

---

## 4. Pull plan — file by file, in order (one slice = one commit, gate green each)

**Rules for every slice:** cherry-pick by hand from the worktree, never `git checkout <branch> --
<dir>`; regenerate `packages/sdk`, `apps/mcp/src/generated`, `tool-catalog-snapshot.ts` and every
migration on main ([[generated-artifacts-automerge-hazard]]); typecheck + `pnpm test:parity` +
scoped vitest per slice, full gate at the integration point.

### Slice 0 — no decision needed (start now)
| Take | How |
|---|---|
| `scripts/src/quote-for-shell.ts` + test, the three parity checks, `build-desktop.ts`, `build-payload.ts` | KEEP AS-IS — a real fix (`pnpm test` dies on a checkout path with a space) |
| `packages/ui/src/components/Modal.vue` `@focus-outside` | KEEP AS-IS — the persistent picker needs it |
| `first-launch-gate.ts` allowlist | KEEP the idea, **narrow** it to `GET /providers/:id/auth`, the Claude sign-in doors, `GET /github/connection`, the device-flow doors (his opens every `/providers/*` and `/github/*`, incl. `DELETE /github/connection`) — only meaningful with D1 |
| `use-session-settings.ts` hoist (a pick inside a chat writes the new-chat default) | KEEP AS-IS |
| Queue keyed by conversation: `use-queued-send.ts` + 5 call sites + 4 tests | KEEP the keys + drain-on-mount contract; **move the map into a Pinia store** (a module-level `ref` map is a hidden store); add "watched view arrives after mount → no double send" |
| Providers live-switch + interrupt: `start-chat-session-input.ts`, both approval files, `active-session-registry.ts` + test, `ai-agent-provider.ts`, `claude-ai-agent-provider.ts`, `run-claude-chat-session.ts` + test, `fake-claude-query.ts`, `packages/chat/.../apply-live-session-mode.ts` + index | KEEP DESIGN, fix: hand-apply his three `build-claude-sdk-options.ts` hunks onto main's file (never copy it); **await the SDK before moving the holder** (a refused switch into bypass must not leave Vynel's gates and the SDK disagreeing); type the seam `ClaudePermissionMode` instead of `next in SDK_PERMISSION_MODE`; log the interrupt failure via `input.logger` instead of bare `catch {}`; give the fake query `interrupt` / `setPermissionMode` recording into the (currently unused) control log and assert them — today the pre-existing interrupt test passes only because the TypeError is swallowed |
| PATCH `/sessions/:id` mode route | KEEP; move "persist, then push live through `toPermissionMode`" into the `@vynel/chat` op; route stays parse → call → respond; `{ err }` in the warn |
| `AppSidebar.vue` folded-by-default groups | KEEP UI — apply as a ~20-line hunk on main's `:76-97` (`COLLAPSED_BY_DEFAULT` + `readCollapsed`) + his tests verbatim; do not copy the file (main extracted `SidebarWorkspaceCard`) |
| `use-workspace-activity.ts` + test | KEEP AS-IS (pure, reuses `GET /workspaces/statuses`, no new endpoint); the `needs-setup` branch rides D3 |
| `WorkspaceTree.vue` + test | KEEP UI, REBUILD: apply his hunks onto main's file (keep the `TreeStateMark` Global row); extract heading + fold state into `WorkspaceTreeSection.vue` so it lands ≤ main's 450 lines, not 579; `bucketByWorkspaceId` optional (default active); keep main's Global-row test, retire the "no NOT RUNNING group" test with a "Chad 2026-08-24 reversed" note. Tripwire: a new, never-run project lands under NOT RUNNING while "+" lives on ACTIVE — count `createdAt` as "worked" for the first hour, or say so |
| `AppShell.vue` | **DROP the file** (it re-imports the retired `WorkingRail` → typecheck fails, drops `SessionsSidebar` and `WORKSPACE_ONLY_SECTION_IDS`); hand-apply two lines — the `useWorkspaceActivity(...)` call and `:bucket-by-workspace-id` |
| `NewWorkspaceDialog.vue` two-stage door + 6 tests | KEEP AS-IS |
| TasksPanel | **graft onto main's panel, never copy his**: (a) move main's abort block to the top as his `■ ABORT` (no confirm), handler stays `abortLiveSession`, add the Global door (`root.interruptTurn`) so it is never a dead press; drop the listener-less `abortAll`/`resumeAll` emits; (b) replace Queue/Completed tabs with his "All Tasks" label + done→live→queued sort + struck done rows, keep main's row internals; (c) his live-card copy ("Wants your feedback" / "Working on now" / "All done" / "Task N · building now" / "N of M tasks done") driven by `scopeStatus` (NOT a third derivation from `usePendingApprovals` — [[waiting-means-approval-or-set-needs-input]]), lit while an in-progress task exists (drop his queued-task fallback that lights an idle list), `.live-said` block behind a `saidWhileWorking` prop; (d) DROP his dead "Open it" buttons, inline SVG marks, the unused `sessionId` prop, the duplicate `isRunning` prop; mount sites: `:said-while-working` in, `:is-running` out; port his 5 test pins into main's harness, keep main's 20 |

### Slice 1 — first launch (D1 = Chad's flow)
Contracts = main's two kinds + his four on top of main's string-widened lookup and self-heal (keep
both); DB union = main's seven stored kinds + `connect-brain` + `github-backup` (his trim to six
turns stored rows into type-lies and bricks a half-finished 7-step install — his own "Start over"
rescue is unreachable behind the boot screen); handlers restored from fork history
(`git show fe55c557:packages/onboarding/src/seeding/...`), name-workspace on
`setUserProjectsDirectory`; `WelcomeStep` copy, `ConnectBrainStep` + `GitHubBackupStep` (add a
real `disabled` prop to `StepActions` — `busy` is misused as disabled — and web tests: his walk
never renders the two new screens), `WizardDoneScreen` + `WizardFireworks` (dedupe the double
`onBeforeUnmount`), `completed: [choice]` + the store's read-once door; split `OnboardingWizard.vue`
(316) under 300; drop the dead skills/channel/schedule schemas, `suggested-skills.ts`,
`SkillInstallRequest`, `OnboardingStepOutOfOrderError`; fix the step-3 / step-4 copy to what it now
means; SDK regen + parity. `users.projectsDirectory` via drizzle on main (0056).

### Slice 2 — the projects folder model (D2 = yes)
`resolve-new-project-directory.ts`, `ensure-default-workspace-parent-directory.ts`,
`use-default-location.ts`, `workspace-keys.ts`, `FileSystemBrowser` `startPath`,
`CloneRepositoryDialog`, wizard order (`wizard-steps.ts`, `StepPlace.vue`, `use-wizard-plan.ts`,
`wizard-schemas.ts`, `wizard.ts` + test); **rebuild the mint** — `sanitizeFolderName` leaves `.`
and `..` intact, so a project named `..` scaffolds and `git init`s the PARENT of the projects
folder; reject both, assert the result stays under the home, refuse or confirm an existing
same-name folder (today `mkdir recursive` silently adopts it), add scaffold tests (the mint path has
none). The other nine restyled `Step*.vue` (Tailwind → scoped CSS, the retheme Kafi did not take):
**DROP**; hand-port the one copy tweak. Update `docs/module-notes/new-workspace-wizard.md`
(untouched on his branch — contradicts his code).

### Slice 3 — Which project? picker
`pick-folder.ts` + `.ps1`, `scan-folder-for-projects.ts`, `use-pick-project-folder.ts`,
`CreateWorkspaceDialog.vue`, routes + tests: KEEP UI, REBUILD the door — `GET /workspaces/pick-folder`
is a GET with a side effect that parks a request up to 10 min and any page reaching the local API
can pop the dialog → POST; ship the `.ps1` in dist (it is located beside the compiled file via
`import.meta.url` — a missing copy makes the Windows picker return null silently) or use the
desktop shell's dialog plugin; route tests for pick / scan / setup-complete / setup / repositories.
Decide whether main's inline group select + "New group…" come back (his picker lost them with 10
tests).

### Slice 4 — setup stamp + Finish setting up (D3 = yes)
`mark-setup-complete.ts` + test, `setup-complete` route, serializer, contract,
`use-mark-setup-complete.ts`, `read-project-setup.ts` + test, `list-github-repositories.ts` + test,
`github-connection.ts`, github routes + `use-github-repositories.ts`, `use-ai-providers.ts`,
`use-project-setup.ts`, `FinishSetupDialog.vue`: KEEP the words, REBUILD — on `@vynel/ui` Modal
(**DROP `WizardModal.vue`**, a second modal shell used only here); split 773 lines into row
components; **wire or remove the dead controls** — the repo part/repo picks, env choice and
provider/account pick persist nothing (only `Done`'s stamp is real), "+ Add another part" has no
handler, and the AI Platform row asks a per-project account that "accounts are global" forbids
(Codex/Kimi listed while the contract refuses them); `read_project_setup` is `x-mcp` → run the
mcp-development recipe on main or drop the flag; `workspaces.setupCompletedAt` via drizzle (0057).

### Slice 5 — the folded live line (D4)
If his line wins: rebuild ON main's `LiveTurn.vue` (keep the cross-message merge, agent pointers,
`liveTurnHostSessionId`), Phosphor `CaretDown` not an inline SVG, `<template v-if>` wrapper
(`v-if` + `v-for` on one template), never hide an unresolved ApprovalCard or a blocked call, fold
only when a continuing container passes `collapsible` (his prop doc says so; his code passes it
unconditionally), one clock; port his 4 live-turn tests + the 2 chevron clicks. `ThreadStream.vue`:
DROP (main has the merge + icons), re-add only the `collapsible` line.

### Always
His `0053_abnormal_zemo.sql`, `0054_small_zombie.sql`, both snapshots, `_journal.json`,
`openapi.json`, `api.d.ts`, `namespaced.ts`, `api-tools.ts`, `tool-catalog-snapshot.ts`: never
copied — regenerated on main after each schema / route slice.

---

## 5. What his files would erase if copied over main's (the "never merge" evidence)
- `AppShell.vue`: `SessionsSidebar` + `useSessionsNavigation`, `WORKSPACE_ONLY_SECTION_IDS`
  (phases/features), re-imports the deleted `rail/WorkingRail.vue` → typecheck fails.
- `TasksPanel.vue`: sessions box, "Hit a problem" state, status note, quick-add, step expanders,
  Plan/Session doors, arm-then-confirm delete, real app links, 20 → 13 tests.
- `LiveTurn.vue` / `ThreadStream.vue`: cross-segment and cross-message merge, agent-spawn pointers,
  session icons + engine glyphs, `liveTurnHostSessionId` fix, main's +200 test lines.
- `build-claude-sdk-options.ts`: `ab0edcef` (custom prompt, base toolset, auto-memory off).
- `routes/sessions/index.ts`: the spawned-session `icon`.
- Onboarding: main's self-heal + string-widened lookup; the 2-step tests.
- Picker: inline group select, name-follows-folder, drive-root/home guard, 10 tests.
- Also behind his tree: `WorkspaceTree.vue` loses `TreeStateMark` on the Global row; views lose
  `useSessionIconsByName`.

---

## 6. The freeze seen in the live walk (not reproducible on demand — one fix regardless)
On the worktree (band 18970, fresh DB, gate on, browser attached through Vite), submitting **step
3 (name-workspace)** froze the engine twice: the first engine process spun at 100 % of a core for
minutes and never answered (killed); a second, freshly started process took **24.9 s** on the same
request, then answered 200. In both, the main thread was **not in JS** (`Debugger.pause` could not
fire) and the folder `~/Documents/Vynel/Kafi Review` appeared only when the stall ended. Six later
attempts never reproduced it — the same step on older engines (**4 ms**), on a young engine
(4.9 ms, 70 s CPU profile 99 % idle), on a fresh DB with the browser walking steps 1–3 inside the
first minute (~1 s, 110 s profile idle), an idle young engine polled for 130 s (max 3 ms), a bare
`mkdir` under Documents (0.4 ms). The memory-maintenance tick is not it (first embedding log at
+307 s). One more clue: the folder minted during the stall was **"Access denied" to delete for
~15 minutes afterwards, then deletable** — an external hold on a brand-new folder under
`Documents`, and this box runs Defender with **Controlled Folder Access ON**. The most consistent
reading: a filter driver (Defender/CFA) stalling the engine's **synchronous** `mkdirSync` under a
protected folder — kernel time on the calling thread shows up as the process's own CPU, the main
thread is stuck in native, no JS can run.

**Whatever the cause, the fix is the same and belongs in Slice 1/2:** the step must not
`mkdirSync` on the engine's main thread (`handle-name-workspace-step.ts:37`). His own branch
already has the async op — `ensureDefaultWorkspaceParentDirectory` (`fs/promises` `mkdir`) — use
it, so a slow filesystem can never freeze every room. Kafi: re-test first launch on your own box
(gate on, browser attached) before the smoke sign-off.

---

## Status
| Slice | Gate | Status |
|---|---|---|
| Worktree + band + install | — | done (18970) |
| Area comparison (5 areas) + live UI walk | — | done (this note) |
| D1 | Kafi | **decided 2026-08-27** — Chad's flow minus "Name your workspace" |
| Slice 1 — first launch (5 steps) | D1 | **BUILT** on `feature/mission-control-pull` (worktree `.claude/worktrees/mission-control-pull`, band 18980): contracts + DB union (grows only) + handlers/seeding restored + narrowed gate allowlist + Chad's four screens + fireworks + the door choice parked in the store and opened by the shell; `StepActions` gained a real `disabled`; scoped tests green (46 engine + 25 web), parity green; full gate + live walk in the session log. No `projectsDirectory`, no migration. |
| Slice 3 — Which project? picker | Kafi 2026-08-27: "use the Windows default file explorer, don't remove our old code" | **BUILT** on `feature/mission-control-pull`: `pickFolderWithNativeDialog` with the Windows picker embedded as `-EncodedCommand` (no `.ps1` in dist), `scanFolderForProjects` + Chad's 9 tests, `POST /workspaces/pick-folder` (a dialog is a side effect) + `GET /workspaces/scan-folder` + route tests, `WhichProjectDialog.vue` (Chad's screen, a NEW file) + 8 tests, both doors ("Pull from a folder", "Something I already have") open it; `CreateWorkspaceDialog.vue`, its 12 tests and `FileSystemBrowser.vue` untouched (still used by clone / knowledge / memory) — how the in-app browser attaches to the new screen is a later decision. One project opens its room; several stay in the sidebar (no setup stamp — D3 open). |
| D2–D4 | Kafi / Chad | **open** — next slice discussed with Kafi before anything moves |
| Slice 0 | Kafi 2026-08-27: "Slice 0" + "filter them with the state we already have: idle or running" | **BUILT** as six commits on `feature/mission-control-pull`: shell-quoting fix + Modal focus-outside + mode-pick-becomes-default; the two-stage "+" door; queue-by-conversation (a Pinia store, drain-on-return waits a tick); sidebar Active / Not running **read off `useWorkspaceStatuses`** (no clock, no per-minute re-check — `workspace-activity-bucket.ts`), groups follow their liveliest member, `WorkspaceTreeSectionHeader.vue`, menu groups folded by default; providers live mode-switch (typed seam, SDK first then the holder, refusals surface) + Stop's interrupt-before-abort (failures logged) + the PATCH route pushing through `toPermissionMode`; the work-rail GRAFT (top ABORT with the Global door, Chad's card copy, lit while the task is unresolved, "All Tasks" one list with original numbers, typed lines in the card; main's sessions box / rows / quick-add kept; his dead "Open it" buttons, HALTED state and palette island not taken). Full gate + smoke in the session log. |
| Slices 2–5 | D2 / D3 / D4 | blocked on the decisions |
| The step-3 freeze | — | moot for Slice 1 (the step is gone); the async-mkdir rule stands for Slice 2 |
