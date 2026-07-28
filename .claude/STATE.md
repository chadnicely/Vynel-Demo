# Vynel — current state (RESUME HERE)

**Updated 2026-07-27 (evening).** After a compaction read this first, then `CLAUDE.md` →
`docs/architecture.md` + the memories. State lives on disk, not chat.

## ⏭ NEXT ACTION (2026-07-28, round 8): PHASE D STARTED — plan + forks SETTLED (`docs/module-notes/server-install.md`), **D0 (linux payload) BUILT + GREEN, uncommitted.** **NEXT: commit D0, then D1 (bearer token + version/health endpoint + voice-off-remote; the file master-key vault already landed in D0).**

**Phase D shape (Chad's fork answers 2026-07-28): bootstrap = local-first + restart into
remote; tunnel = node+ssh2 bundled in the payload (local 8998 listener, bearer injected at
the tunnel — web/SDK/window layer untouched); verify = WSL2 (Debian, systemd PID 1) early,
real VPS for final E2E. Slices D0–D5 tracked in the module notes.**

**D0 (this tree): Phase A's "linux payload built" was NEVER TRUE — cross-install was
silently broken (pnpm side-effects cache replays HOST-built natives even with the cache
flag off: better_sqlite3.node arrived win32; supportedArchitectures filters optional deps
only: libnut all-platforms + agent-SDK musl 258MB leaked). Landed: per-target output
(`dist-payloads/<target>/`), glibc pin, cross-install env, `repairCrossBuiltNatives`
(explicit prebuild-install), post-prune magic-byte sweep (fail-loud on foreign REQUIRED
natives, delete host-built optionals), per-target prunes (musl SDK, libnut), bsdtar
drive-colon fix (relative paths), WSL smoke in verify (`release:verify linux-x64
--wsl=Debian`), `createFileMasterKeyVault` + `VYNEL_MASTER_KEY_FILE` (headless keyring
crash fix; keyring import now lazy in boot.ts). PROVEN: linux-x64 PASS + real WSL boot
(16.6s over 9p, 587 MB); win-x64 re-proven through the changed pipeline (1.3s, 510 MB);
pnpm test 3263 green.**

- Committed `a34b8fb` (Phase C) + `c34c5d7` (fix: version stamp via esbuild define —
  the PUBLISHED 0.1.1 reports `--version` 0.0.0 [npm-immutable blemish]; correct from 0.1.2 on.
  Also: build-cli clears dist-npm CONTENTS instead of the root dir — deleting the root EBUSYs
  while any shell sits in it, e.g. the terminal `npm publish` ran from).
- Claude Code integration line (now real): `claude mcp add vynel -- npx -y @vynel/cli mcp`.

**C: `build-cli.ts` generates the WHOLE publish dir (`apps/cli/dist-npm/`, gitignored):
esbuild-bundled cli.mjs (155KB) + mcp-server.mjs (622KB, OpenAPI spec inlined via the JSON
import) + generated `bin/vynel.mjs` launcher (`vynel mcp` → stdio server, else CLI — the
apps stay untouched; the integration lives ONLY in the generated launcher) + manifest with
ZERO dependencies (everything bundled; no workspace: refs can leak). Version rides
tauri.conf.json (one product version stream: 0.1.1). `verify-cli.ts` PASS: npm-pack tarball
asserts (no .ts, no workspace:, zero deps), offline --help, live `schedules mine` round-trip,
real MCP stdio handshake (initialize → tools/list → 84 tools) against the installed daemon.
npm scope `@vynel` unclaimed as of today (registry search empty, @vynel/cli 404).**

## ⏭ NEXT ACTION (2026-07-28, round 5): PHASE B COMPLETE — B3 PROVEN LIVE (COMMITTED `7d55859`). **(superseded by round 6 above)**

**B3: `tauri-plugin-updater` + dialog prompt (`updater.rs`, check-on-startup off-thread,
release-only) against `kafijunior/vynel-releases` (public; code stays private). Signing:
minisign keypair — PUBLIC key baked in `tauri.release.conf.json`; PRIVATE key = Chad's custody
(password manager; `TAURI_SIGNING_PRIVATE_KEY` = content or path; build refuses a repo-inside
path + refuses unsigned builds). `build-desktop.ts` emits `latest.json` (signature + versioned
download URL) and `--publish` pushes installer+manifest via `gh release create` — latest.json
rides EVERY release so `releases/latest/download/latest.json` self-describes. E2E VERIFIED:
prompt → passive NSIS → running exe ProductVersion 0.1.1.**

- Gotchas learned: `generate_context!` needs `serde_json` in crate deps once the config carries
  a `plugins` section (release overlay only → dev cargo check can't catch it); the tauri CLI
  honors `TAURI_SIGNING_PRIVATE_KEY` ONLY (the `_PATH` variant is ignored by the bundler);
  GitHub refuses releases on a zero-commit repo (seeded README via `gh api`); build-desktop now
  wipes the NSIS dir pre-build (a stale installer masked the first unsigned build's failure).
- Cosmetic follow-ups CHIPPED (task_859bfb05): uninstall-registry DisplayVersion stays 0.1.0
  after a passive update; updater log lines absent from vynel-shell.log (likely the log
  plugin's ~40KB default max_file_size). Also still open: task_dc806d8b (embeddings self-heal).
- Key file currently ALSO at scratchpad `vynel-updater.key` — Chad told to move it to his
  password manager; scratchpad is temp.

## ⏭ NEXT ACTION (2026-07-28, round 4): B2 SHIPPED (COMMITTED `71e95a2`) — lifecycle hardening VERIFIED on the real install. **(superseded by round 5 above)**

**B2 verified live on Chad's real install: `taskkill /F` on the shell → ZERO surviving node
processes (the kill-on-close Job Object — `job_object.rs`, assigned right after spawn, handle
never closed by design); double-launch → 1 shell + 1 daemon (tauri-plugin-single-instance,
registered FIRST; second full launch = open/focus main via `windows::open_main_window`,
--jarvis-only relaunch = no-op); logs on disk (`vynel-shell.log` via tauri-plugin-log LogDir +
`daemon.log` = child stdout/stderr redirect with 10MB boot rotation; all shell eprintln! →
log macros).**

- **Live proof of the pre-B2 hole DURING this round:** my earlier container-context boot test
  left an orphaned daemon (its shell died without the exit handler); that orphan held
  `libvips-42.dll` and Chad's interactive upgrade install failed "Error opening file for
  writing" until it was killed. The Job Object makes this class structurally impossible.
- **MSIX container caveat (my shell only):** installs/launches from Claude's shell virtualize
  into `LocalCache` and named-mutex/table isolation makes single-instance tests unreliable
  cross-boundary — verify lifecycle behavior against Chad's REAL install (as done here).
- windows-sys 0.59 needs Foundation+Security+JobObjects+Threading features for the job calls.

## ⏭ NEXT ACTION (2026-07-28, round 2): B1 SHIPPED — THE FIRST INSTALLED VYNEL RUNS. Chad opened the installed app and confirmed it. **(superseded by round 4 above)**

**B1 (uncommitted): `pnpm release:desktop` → `Vynel_0.1.0_x64-setup.exe` (170MB NSIS,
currentUser). Verified end-to-end on this machine: silent install → `%LOCALAPPDATA%\Vynel`
(node.exe + resources\backend|web via externalBin+resources), app boots ~instant, UI served
on 8998 by the INSTALLED node.exe, DB in `%APPDATA%\app.vynel.desktop\data`, window-close
leaves zero processes (graceful path works even before the B2 job object).**

- **`launch_plan.rs` (new):** LaunchPlan Bundled|Repo resolved ONCE on the setup thread (needs
  AppHandle for app_data_dir + version); daemon.rs spawns per-plan — bundled = pinned node.exe
  on dist/server.mjs, env-files `config\release.env` + `<app_data>\config.env`, absolute
  DB/assets/web/models paths + VYNEL_APP_VERSION (env.ts→boot.ts hub device stamp).
- **KEY TAURI LEARNING: bundle config lives in `tauri.release.conf.json`**, merged via
  `tauri build --config` by build-desktop.ts — tauri's build.rs validates bundle
  resources/externalBin on EVERY cargo build, so an active bundle in the base config would
  force dev builds to stage a payload. Base stays bundle-inactive; dev untouched.
- **PRUNE SLICE DONE (round 3, uncommitted):** `prune-payload.ts` — payload 861→511MB /
  16.4k→10.2k files; installer 170→123MB; clean install 663s→102s. Kept = exactly what Node's
  export conditions resolve (ort.node.*, transformers.node.*, one onnx platform dir); verify
  asserts the keeps; embedding download+inference proven green on the pruned staged runtime.
  Agent-SDK tree untouched (excluded from all pruning). Remaining bulk: 254MB SDK native
  claude binary (irreducible), 34MB onnx win-x64, 19MB sharp.
  ⚠ Two container-context observations (my shell = Claude MSIX container; NOT product bugs;
  Chad's real launches fine): NSIS writes virtualize into LocalCache; one in-container boot
  hit "Unable to get model file path or buffer" → revealed the embeddings self-heal matches
  ONLY protobuf errors — spawned task chip `task_dc806d8b` to widen signatures.
- release.env baking: build-desktop writes hub URL + PUBLIC key from the build env when set
  (public values only); hub-less build otherwise.

## ⏭ NEXT ACTION (2026-07-28): PRODUCTION BUILD ARC — plan LOCKED (`docs/release-plan.md`), Phase A (compiled payload) BUILT + GREEN (committed `b221ddf`). **(superseded by round 2 above)**

**Chad rejected the 2026-07-27 D2 plan (shipped readable TS via tsx — plan file deleted) and
locked the professional shape: ONE esbuild-bundled minified payload (all @vynel code compiled
into `server.mjs`, third-party node_modules external — the VS Code/Slack/claude.exe protection
level; real enforcement stays hub-side), feeding THREE modes: desktop installer (B), `@vynel/cli`
npm + MCP stdio for Claude Code (C), SSH server install over plain-HTTP-through-SSH-tunnel (D —
raw public HTTP ruled out, localhost-bind + port-forward + bearer token). Decisions in the plan
doc: bundle-only protection (no bytenode/obfuscator), `@vynel/cli` scoped npm name, order A→B→C→D.**

- **Phase A LANDED (this tree):** `scripts/src/release/` (build-payload / verify-payload /
  payload-targets / collect-backend-dependencies / stage-node-runtime), `pnpm release:payload` +
  `release:verify`. Payload = bundled server.mjs + hoisted third-party node_modules (own
  pnpm-workspace.yaml: nodeLinker hoisted, per-target supportedArchitectures, allowBuilds) +
  assets (migrations-sqlite + instructions content) + web dist + SHA-pinned node 22.18.0.
- **The seam:** `@vynel/instructions/content-root` setter; `apps/local-api/src/server.ts` is now
  an IMPORT-LIGHT entry (env + seam → dynamic-import `boot.ts` [renamed from server.ts]) because
  the speak route loads its .md description at import time. `VYNEL_ASSETS_DIR` (env.ts) drives
  migrations + instructions in bundled mode; unset = dev unchanged. `@vynel/embeddings`
  devDep→dep (real runtime dep).
- **Agent SDK 0.3.220 ships NATIVE per-platform claude binaries** as optional deps (~254MB,
  manifest.json, no cli.js) — payload self-contained; user's wizard-installed Claude Code is for
  AUTH (~/.claude), the SDK runs its own pinned binary (faithful to dev behavior).
- **Measured:** 861 MB installed; cold start 1.3s (first-boot-at-new-location 28.9s = Defender
  scan, one-time). Verified in-repo AND relocated outside the repo. Gate GREEN 587f/3259t.
- **The channel-reply increment is COMMITTED** (`9cf75b9` + `e6c1171` — the 07-27 section below
  predates that); Chad's Telegram DM + group + voice smoke is still owed. The tree holds ONLY
  Phase A + the long-riding `.gitignore` + `docs/how/` ride-alongs (settle in the Phase-A commit).

## ⏭ NEXT ACTION (2026-07-27 evening): THE CHANNEL PIPELINE — Telegram reply-via-tool BUILT (uncommitted); voice VERIFIED already tool-first. **NEXT: increment-6 review fold → commit → Chad smokes Telegram DM + group + voice.**

**Chad extended the locked pipeline model to channels: "it will know from which channel the
message received and where to sent" — group or DM, the reply goes back to exactly where the
request came from, via a tool, never a capture.**

- **Voice = the finished template (untouched):** the native leg DISCARDS text deltas — `speak`
  IS the reply; the voice-turn-marker holds compliance per-message. Verified via explorer map.
- **Telegram was the inverse; now matches:**
  1. **`reply_to_channel`** (routing surface, 84 tools) — args `{ message }` ONLY; the
     server-stamped ambient origin header (`x-vynel-delegation-origin`, extended with
     `externalMessageId` for group threading) addresses it: exact sender + chat context,
     threaded onto the asking message in rooms. No header → actionable 400.
     Op: `replyToChannelOrigin` (channels/delivery). `send_to_channel` stays for PROACTIVE
     pushes (unchanged).
  2. **Per-message channel marker** (`composeChannelTurnMarker`, the voice-turn-marker
     precedent): "(This message arrived via TELEGRAM from Alice in group "X" — reply by
     CALLING reply_to_channel…)". Provider input ONLY (core appends beside the voice block);
     persisted row clean. Composed at the channels edge (knows sender/room facts).
  3. **CAPTURE REMOVED** (route-as-chat-turn): the turn's chat text is never auto-shipped to
     the channel. Error-status apology (thrown turns) + approval-card push + group speaker
     line unchanged. A turn that never calls the tool sends nothing (the locked no-harvest
     rule; the marker pushes hard).
- **Unchanged by design:** channel-driven DELEGATED tasks still deliver their distilled reply
  to the channel at completion (the tick's channel block — the Ch4 loop).
- global-root.md names the tool; 4 process-inbound tests recast (no-capture pins); new tests:
  marker composer, reply op (DM/group/guards), route (header delivery + threading, 400).

Gate GREEN 586f/3256t. **Increment-6 review CLEAN; all folds in:** two stale comments fixed
(channels-types runRootTurn contract no longer claims the result is delivered; the
enqueue-channel-reply header names the real enqueuers + the adapter's address-by-chat-context
semantics), and the silence-observability log added (a channel turn that produced chat text but
delivered nothing logs it — a "Telegram went silent" report is diagnosable without the
transcript). Reviewer verified: marker⇔header coupled at one site; reply_to_channel is
routing-surface-only (a global-grounded spawned session gets the designed 400); group replies
address the ROOM (the adapter sends by chatContextId); the recasts preserve decision-3 +
threading semantics. READY TO COMMIT on Chad's word.

## ⏭ NEXT ACTION (2026-07-27, round 3): THE PIPELINE MODEL LOCKED + BUILT (uncommitted, one tree, rounds 1-3) — **NEXT: increment-5 review fold → commit → Chad smokes the corrected pipeline.**

**Chad REJECTED round 2's chain-hops-in-Global (it violated his own 2026-07-21 scoping rule,
which he has now re-explained "many times") and LOCKED the model (memory:
session-comms-pipeline-model; he confirmed my restatement + added the report-box design):**
- **Chips go ONE level down per surface.** Global thread → workspace chip only; the session's
  chip lives INSIDE the opened workspace watch (the trace entries' own dispatch cards, now
  enriched + drillable — ActivityMonitorPanel pushes a nested trace node, Back pops); session
  view = leaf, no chips.
- **NO HARVEST.** Reports travel ONLY via send_message. The tick's completion co-commit is now
  complete + surface ALWAYS (completed rows MUST be surfaced or the root catch-up re-injects
  resultText — the capture leaking back through the other door); FAILED rows stay unsurfaced
  (failure note = status, not capture). Distill now runs ONLY for channel-driven jobs (it
  serves the channel delivery alone, which is unchanged). Silence delivers nothing; chips +
  get_background_run carry status.
- **Reports render as a COMPACT incoming box:** identity + Report pill + one-line teaser +
  "View report" chip → the shared ReportViewDialog (PlanViewDialog pattern: ui.viewingReport,
  AppShell-mounted) shows the full markdown. Never the full body inline.

chainHops fully reverted (contract/zod/enrichment/UI/barrel/tests/SDK). Heavy test surgery:
delivery-cocommit recast to a throwing surfaced-mark; 7 tick tests recast (channel-driven
fail-open + short-skip; session/workspace/no-runner tests direct-enqueue the delivery so the
notify machinery stays covered). Gate GREEN 584f/3248t.

**Increment-5 review CLEAN; both should-fixes FOLDED:** (1) the co-commit fallback retried the
surfaced mark standalone (a transaction hiccup could otherwise resurrect the capture via the
catch-up; the always-throwing-mark window is the one ACCEPTED echo, documented in code + test);
(2) the stale exactly-once comment beside the catch-up net's query updated to the no-harvest
semantics. Reviewer verified: only collectDelegationReportsForRoot reads surfacedToRootAt; the
notify machinery stays live via dispatch-message + run-monitor-tick; the distill/channel gates
share ONE reportOrigin resolution; chainHops residue = zero. Deferred notes: teaser leaves
link-markdown raw; panel's nested-push wiring untested (same as the session drill);
SessionThreadView owes an @open-report listener only if requester kinds ever grow
'spawned-session'. **The `.gitignore` + `docs/how/` ride-alongs remain uncommitted (5th
review mention) — settle at commit time.**

**Chad's re-smoke proved round 1's rendering (the "SARAH · LETTERMAN — REPORT" card shows) and
exposed the DEEP bug: the workspace's notify turn REASONED "the user is reporting back the
result…" about the session's report — it believed the USER delivered it, so it summarized for
the user instead of relaying the real result up to Global. Global only ever saw the premature
"done — session spawned" partial. The voice instruction-decay class: a system steer alone does
not hold attribution.**

1. **Per-message attribution marker** (`@vynel/contracts/chat/report-message-marker`): the
   delivery tick prepends `[Report from <label> — …relayed automatically by Vynel. This is NOT
   a message the user typed.]` to every notify-turn inbound (ONE home, both requester
   branches); MessageRow strips it for display (the card's author line already carries
   identity). Channel deliveries stay unmarked; distill runs before enqueue so the marker is
   never distilled.
2. **Steers**: REPORT_DELIVERY_INSTRUCTIONS now states the system relayed it + names
   `send_message` to "requester" (report_to_requester = older alias); ROUTED_TASK_INSTRUCTIONS
   forbids calling the WHOLE task done when work was handed onward.
3. **Chain-hop watch chips** (Chad's ask: watch the spawned session FROM Global): the
   delegation enrichment resolves the job's threadId chain (`listDelegationJobsByThread`, newly
   exported) → TASK hops with per-hop trace keys + session display names; `chainHops` on the
   contract; ToolCallList renders one chip per hop (also fixed the 4×-invocation note) — so the
   send card in Global shows "letterman — done · report delivered" AND "Letterman –
   Architecture — working…", each opening its own realtime trace.
4. 7 assertion recasts in run-delegation-claim-and-run-tick.test.ts (delivered body now rides
   the marker — each cites the spec change); marker round-trip + strip + chain tests.

Gate GREEN 584f/3249t. Increment-4 review CLEAN; both should-fixes FOLDED: (1) the marker
strip is first-line-anchored (a user-chosen workspace name containing `]` — "Q3 [phase 2]" —
defeated the old indexOf-`]` hunt; bracket-label test added); (2) the trace drill
(ActivityEntriesList) both leaked the model-only marker AND had the same user-role "You"
mislabel MessageRow had — it now mirrors MessageRow's isInboundReport predicate for author +
strip. Reviewer verified: no job row stores marked text (composed in-memory at claim), distill
can never see it (runs before enqueue), channel deliveries unmarked, chain ordering/scoping/
legacy-null-threadId edges all correct. Design note for the next smoke: a mid-chain dispatch
card shows the WHOLE chain including its own hop — filter to at-or-after-base if it reads oddly.

**Chad's live smoke of session-comms (the loop WORKS: Global → send_message → workspace →
complete → report back) surfaced two UX bugs, both root-caused and fixed:**

1. **The report rendered as "You".** The row was persisted CORRECTLY (`role:'user'` +
   `sourceKind:'workspace-manager'` + `sourceLabel:"<manager> · <workspace>"` — the whole
   attribution chain held); `MessageRow.vue`'s user branch just only special-cased
   `'global-root'`. Fix: `isInboundReport` → author line = sourceLabel, a "Report" pill,
   the workspace accent, MARKDOWN body rendering (reports are model prose), and no "your
   message" bubble (`.is-report`). Rendering-only; no schema/backend change.
2. **No watch/details after completion.** The processing banner lists `pending|claimed` only,
   the send tool cards were inert generic JSON, and the sending message carries no trace key —
   so a settled delegation had NO surviving door to its trace. Fix: serve-time enrichment
   `attachDelegationToolOutcomes` (`packages/session/src/delegation/`, sibling of
   `attachDelegationTaskLabels`) — parses the dispatch call's persisted output for the route's
   `{jobId, deliveredTo}`, joins the job row, attaches
   `delegation: {jobId, partialSessionId, status, deliveredTo, taskLabel, reportedAt,
   completedAt}` onto `ChatToolCallResponse` (contract + zod + SDK regenerated); both detail
   routes wrap `toolCallsByMessageId`. UI: a PERSISTENT `.delegation-chip` under the dispatch
   card in `ToolCallList` ("Acme · Summarize the docs — done · report delivered"), live dot
   while in flight, emits `openDelegation` → ThreadStream forwards into its existing
   `openSession` emit → every view already wires that to `activityMonitor.openTrace`. Zero
   view changes. Live-streamed rows carry no enrichment (the banner covers the live window);
   the chip appears from the settle refetch on.

Gate GREEN 583f/3241t. Review: ONE must-fix, FOLDED — the three dispatch routes name the
destination DIFFERENTLY (`send_message`→deliveredTo, `send_task_to_workspace`→workspaceName,
`send_task_to_session`→sessionName); the parser read only deliveredTo, so every send_task chip
would have said "session". The fabricated test fixture DEFENDED the wrong shape (the
[[source-label-is-persona-first]] lesson repeating) — tests now feed each tool its verbatim
route response. Reviewer's residuals: the LIVE-window user row may render as "You" until the
settle refetch (self-heals; smoke to confirm); `delegationChipFor` called 4× per chip
(cosmetic); the `.gitignore` + `docs/how/` ride-alongs STILL uncommitted from before.

## ⏭ NEXT ACTION (2026-07-26, session 2): TASK 4 COMPLETE — (a) the ask-mode gate + (b) per-package exposure BOTH SHIPPED (uncommitted, gate GREEN 581f/3232t) — **NEXT: Chad commits, then smokes the ask-mode card live (an ask-mode `remove_knowledge_source` or `delete_agent` must card).**

**Session 2 verified session 1's three DONE claims against the code (all real: browser doors have
zero callers, the 3 hang bounds exist, dispatch-message.ts routes reports by server-stamped
headers) and re-ran the gate (green at the old 3224 count) before starting task 4(a).**

### ✅ TASK 4(a) — the ask-mode approval gate (THIS session, needs commit)

- **The mechanism fork is SETTLED by a live smoke (2026-07-26):** in SDK `default` mode a bare
  `allowedTools` entry auto-approves BEFORE `canUseTool` (the SDK even warns
  `CAN_USE_TOOL_SHADOWED`) — and a PreToolUse `permissionDecision: 'ask'` DOES override that
  pre-approval and routes into `canUseTool`. So mechanism (a) from the prior session's fork:
  `askModeApprovalToolNames` through the existing hook seam. No composer/wildcard rework.
- **The destructive tier:** generator classifies DELETE-method routes + a new opt-in
  `x-mcp.destructive` flag → emits `generatedAskModeApprovalToolNames` (today:
  `remove_knowledge_source` only; future REST deletes join automatically). `mutatingApproved`
  now means ONLY "may be emitted" — the double-duty is resolved.
- **Threading (parallel to `mutatingToolNames` everywhere):** descriptor contract (optional
  field) → 3 vynel descriptors → composer (deduped union; alwaysOn contributes none) → all turn
  entry-points (chat-turn, session-turn, global-root-turn, run-global-root-turn,
  fire-schedule [inert under D10, forwarded deliberately], routed-turn-provider-input
  [REQUIRED field so no producer can omit]) → StartChatSessionInput → buildClaudeSdkOptions →
  buildClaudePreToolUseHook. Hook cards the tier when mode is `ask` OR `plan-only` (defensive —
  plan mode's allowedTools honor is unsmoked); auto/bypass run it uncarded.
- **FLOOR CHANGE (flag to Chad):** `mcp__vynel__create_memory_entry` REMOVED from
  `TOOLS_ALWAYS_REQUIRING_APPROVAL` per his refinement ("self-tools do NOT need approval") —
  supersedes the 2026-06-20 memory-writes-card directive. One canUseTool test recast to the new
  spec (bypass memory write = silent allow). `register_workspace` + desktop `act_on_app` KEPT
  always-carding (conservative; ask Chad if they should drop to the tier).
- **Review folds:** fire-schedule forwarding assert; provider-seam end-to-end test (the
  conditional-spread chain is invisible to excess-property checks — the test pins the OPTIONS
  the SDK received); plan-only in the tier condition.
- **Ride-alongs at commit time:** `.gitignore` +`.notes/` line + untracked `docs/how/` predate
  this session — split or fold deliberately.

### ✅ TASK 4(b) — per-package exposure SHIPPED (same session; Chad's sign-off obtained)

**Chad's calls (AskUserQuestion, this session):** expose ALL useful tools — only
onboarding/dashboard stay user-surface (approvals never); AND move register_workspace +
desktop act tools to the ask-only tier (uncarded in auto/bypass).

- **Tier moves:** the x-mcp flag renamed `destructive` → `askApproval` (register_workspace is
  ask-carded by Chad's call, not because it destroys anything). register_workspace rides the
  generated tier; vynelRoutingDescriptor + desktopFeatureDescriptor `mutatingToolNames` now
  BOTH `[]` — nothing Vynel/desktop cards in auto/bypass anymore; the every-mode floor is just
  Bash/Write/Edit/NotebookEdit.
- **13 new tools (70 → 83):** agents end-to-end (list/get/list_curated reads + create_agent /
  install_curated_agent / update_agent / set_agent_enabled + delete_agent [auto ask-tier]),
  list_capabilities (READ only — the PUT toggle is the approvals-class hazard: an agent
  re-enabling its own denied tools), workspace marketplace (list/get + install +
  uninstall_marketplace_item [askApproval — skill uninstall hard-deletes files]; REVERSES D9's
  no-exposure call per Chad's mandate — the reads are back because install needs itemId).
- **Deliberately NOT exposed (rationales in the route file headers):** files (native
  Read/Write/Glob already cover it), asks-answering (human's half), hub (credentials), root
  (human stop-controls + turn recursion), notebook CRUD (user-curated by design; playbook
  reads already live via vynel-notebook), ssh register/delete (credential door), activity
  (SSE), user-scoped marketplace twin (root-surface install deferred — workspace covers the
  real use), capabilities PUT, onboarding, dashboard, approvals.
- **Generator bugfix (pre-existing, exposed by update_agent's nullable enums):** a
  `z.enum([...]).nullable()` body field reaches the spec as enum-with-null-member and the
  emitter produced `z.enum([..., null])` — invalid source. Now strips the null + appends
  `.nullable()`.
- The ask-approval tier is now: delete_agent · register_workspace · remove_knowledge_source ·
  uninstall_marketplace_item (the FULL set is pinned in vynel-mcp-feature-descriptor.test.ts).
- **Increment-2 review CLEAN; its 3 should-fixes folded:** stale `destructive` comments renamed;
  query params named `workspaceId` now get the ambient scope stamp (mirrors the body stamp —
  without it a workspace turn's list_agents silently returned user-scope only; gained by
  list_agents + get_agent ONLY, no pre-existing tool changed); the full tier pinned.
- **Reviewer's deferred notes (not done):** as-built doc book stale on the old no-exposure
  posture (`.claude/docs/agents/structure.md:132`, `.claude/docs/marketplace/structure.md:128`);
  generator's numeric-enum `z.enum([1,2])` latent bug (no current route triggers it);
  `mutatingToolNames` now `[]` on every production descriptor — dormant-but-kept seam.

### ❌ ALSO OUTSTANDING (carried from session 1)

- `channel.message-received` outbox event does not exist (Chad's Telegram monitor example).
- Remove the three superseded routing tools after one release.
- `pnpm lint` has never passed (`eslint-plugin-n` missing + 4 real import-type errors).
- Bug sweep barely started; Chad wants zero bugs before production.
- Untested at runtime by Chad: monitors end-to-end, send_message, spawned-session tool
  inheritance — AND now the ask-mode card (needs a live ask-mode `remove_knowledge_source`).

## (prev) ⏭ NEXT ACTION (2026-07-26): SESSION-COMMS + MONITORS SHIPPED (8 feat commits, gate GREEN 581f/3224t) — **TASK 4 NEVER STARTED: the ask-mode approval gate + per-package exposure. START THERE.**

**Chad's 4 asks this session. Three done, the fourth — which he named as the point — untouched.**
He ended the session to reopen it fresh: *"how much you completed is good. Let's wrap up this
session, I see you confused."* The confusion was mine: items 3's follow-ons kept expanding and I
never came back to task 4.

### ✅ DONE

1. **Browser view PARKED** (`588e551`) — both doors removed (title-bar globe + palette item);
   panel/store/composable/tauri commands kept whole. Unpark = restore those two doors, nothing
   else was unwired. The modal-registry + notifier-docking root fixes from `9edc322` STAY.
2. **MCP hang audit** (`588e551`, `docs/module-notes/mcp-tool-hang-audit.md`) — all 61 tools
   inventoried. Most were already bounded. Three were NOT: `create_session`'s priming drain
   (now 120s + interrupt), `generateEmbedding`'s first-call model download (bounds the WAIT,
   never the load — abandoning a half-written model file is the truncated-cache bug), and the
   external stdio server's raw fetch (150s abort + named timeout). Zoom's 3 fetches swept.
   **Deliberately NOT done:** a generic timeout on the generated in-process dispatch — that is
   Hono in-process, so a race cannot cancel the handler and a mutating tool would double-commit.
3. **Monitors + session-comms** — the arc that ate the session:
   - `d2b61bd` `list_background_runs` / `get_background_run` — the jobId was a dead handle.
   - `8749894` **`@vynel/monitors` leaf** (migration 0019) + `6e63945` two scoped doors +
     `a3a6dbb` **the tick** (armed watches now actually fire). `docs/module-notes/monitors.md`.
   - `74389a6` **`threadId`** (migration 0020) — `partialSessionId` is PER-HOP by design, so a
     two-hop chain produced four unrelated keys. threadId is the envelope; a chain-starting hop
     self-seeds from its own hop key, which is why 0020 needed no backfill.
   - `63579b3` **`send_message`** — ONE tool for every session-to-session message, replacing
     send_task_to_workspace / send_task_to_session / report_to_requester (**all three still
     exposed for ONE release as aliases, descriptions marked SUPERSEDED — remove them next**).
     Needed a new generator flag `x-mcp.workspaceSurface` so a root tool also rides the plain
     workspace array (the surfaces were mutually exclusive).
   - `accd024` **tool-first reporting** (migration 0021) — the tick used to harvest the child's
     chat reply. Now a turn that reports via the tool marks its own row and the harvest is
     skipped; the harvest REMAINS as the fallback (silence is worse than a chatty report).
   - `6bdec01` **spawned sessions inherit the parent's toolset** — Chad's call, reversing the
     earlier "the leaf, not a router" pin. NO depth cap (raised, he declined). The bigger find:
     GLOBAL-grounded spawned sessions had NO tools at all and could not even report back.
   - `23c80c8` fixed a REAL pre-existing flake: the claim orders by (createdAt, id) and the
     three test enqueues can share a millisecond → random-uuid tie-break. Proven by forcing the
     collision (3 of 6 runs failed). Enqueue ops now take an injectable clock.

### ❌ TASK 4 — NOT STARTED. This is the next action.

Chad's words: *"expose all the functionalities to Claude for all packages so the user can manage
them through chat... if on ask mode it will be gated through approval; for auto and bypass no
approval."* Then refined: **"Vynel MCP approval is for DELETE and anything destructive. Claude's
self-tools (memory, knowledge, tasks) do NOT need approval."**

**(a) THE GATE DOES NOT EXIST.** `apps/local-api/src/sessions/compose-session-mcp-servers.ts:58-59`
pushes `mcp__vynel__*` into the SDK's `allowedTools` unconditionally — and `allowedTools` is
documented as "auto-allowed **without prompting**". So in ask mode NO Vynel tool cards today.
Only the static floor (`create_memory_entry`) and per-turn `mutatingToolNames`
(`register_workspace`) card, via the PreToolUse backstop.
- **Two mechanisms, and the choice needs a 5-minute live smoke first:** does a PreToolUse
  `permissionDecision: 'ask'` OVERRIDE an `allowedTools` pre-approval in SDK `default` mode?
  The 2026-06-21 smoke proved it works under `bypassPermissions` — a DIFFERENT mode. If yes →
  add `askModeApprovalToolNames` beside `alwaysRequireApprovalToolNames` (~20 lines, the set
  already flows through `buildClaudeSdkOptions` → `buildClaudePreToolUseHook`). If no → stop
  emitting the wildcard in ask mode and enumerate read-only tools instead (cross-cutting: the
  composer does not know the permission mode today).
- **`x-mcp.mutatingApproved` currently means BOTH "may be exposed" AND "runs with no card"** —
  one flag doing two jobs. Bulk-adding it to expose more routes would silently create a large
  never-carded surface, the exact inverse of what Chad asked for.

**(b) 13 ROUTE DIRS EXPOSE NOTHING:** activity, agents, approvals, asks, capabilities, dashboard,
files, hub, marketplace, notebook, onboarding, root, ssh-servers.
- **`approvals` must NEVER be agent-exposed** — an agent that can resolve its own approval
  requests defeats the whole gate. Proposed (NOT yet approved by Chad): expose files /
  ssh-servers / agents / marketplace / notebook; leave hub / onboarding / dashboard / root /
  activity / capabilities user-surface-only. **Get his sign-off on the table before writing.**

### ❌ ALSO OUTSTANDING

- **`channel.message-received` does not exist** — inbound channel messages route straight to a
  turn with NO outbox event, so Chad's own Telegram monitor example ("trigger whenever a message
  happens") cannot be armed. Small additive co-commit at the inbound boundary; also closes an
  invariant-5 gap independent of monitors.
- **Remove the three superseded routing tools** after one release.
- **`pnpm lint` HAS NEVER PASSED** — `eslint-plugin-n` is NOT installed but the config uses
  `n/no-process-exit`; 419 of 480 errors are "rule not found". Pre-existing (verified by
  stashing). Plus 4 real `import()`-type-annotation errors in two test files from `94f3eaf`.
- **Bug sweep barely started** (one round: found + fixed 17 dead imports the dispatch extraction
  left in routing/index.ts — typecheck missed them because `noUnusedLocals` is off; lint caught
  them). Chad wants zero bugs before production.
- **Untested at runtime by Chad**: monitors end-to-end (arm → event → wake), send_message,
  spawned-session tool inheritance. All green in tests; none smoked live.

## (prev) ⏭ NEXT ACTION (2026-07-24): ZOOM PARKED ("coming soon", ONE catalog flag) after live wire-debugging — Chad's call; TELEGRAM (DM + groups) fully live and confirmed; NEXT: whatever Chad opens (channels arc is CLOSED for now)

**The Zoom connect attempt became a live debugging session (full findings in
docs/module-notes/channels-zoom.md "PARKED" section): connect succeeded (after fix rounds 2+3
— accountId auto-detect via token `aid` FAILED empirically, the chatbot token has NO aid claim
→ replaced with LEARN-from-bot_notification `57a8cf9`, verified necessary by wire-captured
token claims) but NO events ever arrived. Sole-listener wire probe (app channel paused —
**Zoom = ONE consumer per subscription id**, second connect kicks first) proved:
`bot_notification` is NOT in his account's Event Types catalog (only chatbot Added/Removed
membership events); 32 subscribed account chat events produced ZERO frames on messaging;
Local Test/authorization was possibly never completed ("Not ready"). Chad: "keep the code,
comment zoom out".**
- **The park = `zoom.available: false`** in channel-catalog.ts (renders "Coming soon" like
  discord, not selectable — dialog test recast with the spec-change comment). EVERYTHING else
  stays live + green: adapter (+learn-account-id), unions, routes, SDK, tests. His Zoom
  channel row remains, PAUSED (disabled via local API during probing).
- **To UNPARK: authorize the app (Local Test → Add) → re-run the sole-listener probe
  (.data/zoom-probe.cjs pattern in git history / notes) → read the ACTUAL event name+payload →
  adapt zoom-event-socket if it's chat_message.* shaped → flip the flag.**
**Channels arc summary (this session, all pushed): channels UI+manage `16517e7` · groups
`7aecbac`+`ede06eb`(privacy-mode discovery fix)+`0c198fb`(group /cmd fix) — CONFIRMED live
with real Telegram traffic · zoom `425e895`+`ef8a4a2`+`57a8cf9`+the park.**

## (prev) ⏭ NEXT ACTION (2026-07-23 round 6): ZOOM CHANNEL SHIPPED — gate GREEN 569f/3119t, reviewed CLEAN (2 should-fixes FOLDED); groups arc CONFIRMED live by Chad (real traffic) + group-command fix `0c198fb`; NEXT: CHAD ZOOM SMOKE (below)

**Chad: "We can start zoom" (after live-confirming groups). Built per
docs/module-notes/channels-zoom.md (As-built + Review-folds sections are the truth):**
- **`ZoomChannelAdapter`** (`adapters/zoom/`: zoom-api / zoom-event-socket / zoom-channel-
  adapter): the STATEFUL shape — one WebSocket per connected channel (wss://ws.zoom.us,
  subscriptionId + client_credentials token, 25s heartbeat), bot_notification frames
  normalized defensively + buffered, `pollForInboundMessages` DRAINS per tick (zero pipeline
  change). Dead sockets recreated next tick; **CONNECTING grace 30s** (no teardown-per-tick
  token loop — reviewer catch, readyState-0 pinned); **self-scheduled unref'd reap timer**
  (the LAST channel's socket dies 60s after polling stops — reviewer catch, fake-timer
  pinned); buffer capped 500; send/edit over Chatbot Messages API with per-app token cache.
  Capabilities: EDIT yes · buttons no v1 (approvals = typed approve/deny; enqueue gates on
  supportsInlineButtons) · typing no. Groups ride the groups arc as-is (toJid @conference. =
  group, title = channelName, bot_notification inherently addressed). New dep `ws`.
- **'zoom' in EVERY union** (schema/contracts/route enums/SessionTurnOrigin/
  ReportDeliveryTarget+format rule/MessageRow badge/GlobalChatView label/ProcessInboundDeps/
  run-global-root-turn) — the two exhaustive-map guards caught their sites at typecheck.
  SDK regenerated (201 methods, 61 tools unchanged).
- **Connect dialog fully catalog-driven**: entries carry defaultName + credentialFields[] +
  allowedSenderField — telegram 1 field, ZOOM 5 (clientId/clientSecret/botJid/accountId/
  subscriptionId), discord unavailable. The telegram-hardcode nit CLOSED. Zoom has NO
  initial-sender field (JIDs unknowable — add from Manage). Zoom brand mark added.
- **RECORDED (zoom notes)**: interactive buttons + app_mention subscription later ·
  recently-ignored-senders quick-allow in Manage (zoom onboarding wants it) · verify on the
  real account: bot_notification messageId presence, token-response field casing, WS content
  string-vs-object (both handled) · rotation staleness nits. ONE gate flake seen (the known
  chat_sessions UNIQUE seed), clean on two reruns.
**⏭ CHAD ZOOM SMOKE: marketplace.zoom.us → Build App → Team Chat app → imchat:bot scope →
Features: enable Team Chat subscription (get Bot JID) + Event Subscriptions in WEBSOCKET mode
subscribing bot_notification (get subscription id) → copy clientId/secret/accountId · Vynel →
Channels → Connect → Zoom card → paste the 5 values → Connect verifies via token grant ·
1:1 chat with the bot in Zoom → message arrives (first one lands IGNORED — add yourself as
allowed sender from Manage with your userJid from the ignored row… OR just check the reply
works after adding) · reply arrives in Zoom · add the bot to a Team Chat channel → it shows
in Manage → Groups → approve → slash-invoke it in the channel → threaded reply · transcript
shows "via Zoom".**

## (prev) ⏭ NEXT ACTION (2026-07-23 round 5): CHANNEL GROUPS SHIPPED — gate GREEN 568f/3102t, reviewed CLEAN (3 should-fixes FOLDED); NEXT: CHAD GROUP SMOKE (below), then the Zoom adapter arc

**Chad's ask post-smoke ("start implementing group features… zoom also has group chat") —
3 forks settled by Chad: per-group memberPolicy toggle (everyone default | allowlist) ·
@mention-only replies (per-group respond-to-all = recorded follow-up) · approvals NEVER post
into groups. Notes: docs/module-notes/channels-groups.md (as-built + follow-ups).**
- **NEW `channel_chat_groups`** (migration 0018, additive; UNIQUE (channelId, context)):
  pending|approved|ignored + memberPolicy. **Discovery-over-configuration: add bot to group,
  @mention once → pending row (+`channel.group-discovered` outbox co-commit, IF-ABSENT insert =
  the overlapping-tick net) → Manage dialog Approve/Ignore.** No chat-id pasting.
- **Adapter contract grew group awareness**: NormalizedInboundMessage +chatContextKind/
  chatContextTitle/isBotMentioned (REQUIRED); poll input +optional botIdentity. Telegram:
  entity-located @mention (never substring — email-shaped text can't match) + reply-to-bot;
  callbacks inherently mentioned; absent chat.type = dm (legacy shape).
- **Tick group gate BEFORE dedup**: unknown → record+skip · pending/ignored → skip (NO rows —
  busy rooms can't flood audit) · approved → mention gate → policy ('everyone' = room approval
  IS permission; 'allowlist' = findAllowedSender scoped to the GROUP context id — zero schema
  change). Sender/room facts ride messageMetadata JSON (no inbound schema change). Group
  liveness only moves forward.
- **Routing**: group turns open with a speaker line ("[Group message from Alice in
  \"Marketing Team\"]"), replies THREAD onto the asking message (replyToExternalMessageId on
  enqueueChannelReply), onApprovalRequested early-returns for group origin (logged).
- **4 routes** (listGroups/approveGroup/ignoreGroup/setGroupPolicy over 3 new groups/ ops,
  each outbox co-committed; cross-channel groupId = same 404, pinned) · SDK 201 methods,
  61 MCP tools UNCHANGED · NEW ChannelGroupsBlock.vue in ManageChannelDialog (+3 composables;
  errors surfaced, select re-syncs on failure) · contracts ChannelChatGroupResponse.
- **RECORDED (notes)**: /command@bot carries bot_command entity (fold when channel commands
  ship) · polling setInterval has NO in-flight guard (root cause the if-absent insert nets —
  own slice) · re-approve idempotency noise · user-scoped.ts 482 lines.
**FIX ROUND (same day — Chad's smoke FAILED, root-caused from his live DB): the @mention
NEVER ARRIVED — Telegram default bot privacy mode delivers group bots ONLY /commands
addressed to them, replies to their messages, and SERVICE updates; never plain "@bot …"
texts. The mention-discovery ritual was a false premise. Fixed (reviewed CLEAN, folds in):
discovery rides `my_chat_member` (privacy-proof — ADDING the bot is the ritual; adapter
grew `groupSightings` on the poll result; ONE recordGroupDiscovery home, both paths) ·
`/cmd@bot` counts as addressed (bot_command entity suffix-match — '@' in the needle makes
false positives impossible) · wire shapes + 3 pure helpers split to
telegram-normalization.ts (size rule) · dialog copy teaches reality (add-the-bot empty
state; replies + /cmd@bot work as-is; @mentions need bot-as-admin OR /setprivacy Disable +
remove/re-add). RECORDED: left/kicked lingers approved (surface "bot removed" later) ·
sighting seenAt = tick-time · bare /plan not addressed by design.**
**⏭ CHAD GROUP SMOKE (retest): restart api → the group you ALREADY added: send
`/start@<botname>` in it (or remove + re-add the bot) → Manage dialog shows it "Wants in"
→ Approve → REPLY to any bot message or `/ask@<botname>` → Claude answers IN THE GROUP,
threaded; web transcript shows "[Group message from …]" · for plain @mentions: make the bot
group admin (or BotFather /setprivacy Disable + re-add) then @mention works · allowlist
policy + never-post-approvals checks as before. Then: the Zoom adapter arc
(docs/module-notes/channels-zoom.md — model ready, needs 'zoom' kind + credential-fields
connect dialog + the stateful WebSocket adapter).**

## (prev) ⏭ NEXT ACTION (2026-07-23 round 4): CHANNELS UI + MANAGE SHIPPED `16517e7` (pushed) — gate GREEN 566f/3085t, reviewed CLEAN (3 should-fixes FOLDED); ZOOM RESEARCHED (feasible); NEXT: CHAD SMOKE (below), then more channel kinds

**Chad's channels session ("show channel icons · edit/update, allowed users · telegram first,
then check zoom"), notes in docs/module-notes/channels-ui.md + channels-zoom.md:**
- **Brand marks**: NEW `components/channels/` — ChannelBrandIcon.vue (simple-icons SVG in brand
  color) + `channel-catalog.ts` = the ONE home for kind presentation (label/tagline/connectHint/
  available + isChannelHealthy/channelConnectionNote/channelStatusPill); absorbed + DELETED
  chat/channel-presentation.ts. Section rows, connect dialog, welcome hero all ride it.
- **STRICT scope visibility (Chad's explicit rule)**: global list = ONLY null-workspace
  channels; workspace list = ONLY its own. Scope chips died. Old own+global filter test
  RECAST with the spec-change comment.
- **ManageChannelDialog** (+5 composables): rename · pause/resume pill · allowed-senders
  list/add/remove (arm-to-confirm) over the EXISTING routes (enable/disable + allowlist CRUD
  had zero UI). Channel row resolves LIVE from the list query by id (the PlanViewDialog
  lesson); name input seeds ONCE per open keyed on "open + row resolved" (row may still be
  loading at open).
- **NEW `PATCH /channels/:channelId`** (rename — the one missing API piece) over NEW
  `renameChannelForUser` + `channel.renamed` outbox event (co-commit, tenant-404 pinned);
  boundary `.trim()` (reviewer). SDK regenerated (197 methods, `channelsUser.rename`;
  namespaced pin +rename); 61 MCP tools UNCHANGED (route not x-mcp).
- **RECORDED (notes)**: connect dialog hardcodes telegram's credential form — needs per-kind
  credential FIELDS before a second connectable kind · pause pill aria (WCAG 2.5.3) ·
  ManageChannelDialog 366 lines · stray vite timestamp artifact deleted (consider gitignore
  pattern — left .gitignore alone, it holds Chad's uncommitted .notes/ edit).
- **ZOOM (docs/module-notes/channels-zoom.md): FEASIBLE local-first** — Team Chat bot +
  Zoom **WebSocket event delivery** (wss://ws.zoom.us, subscriptionId + client-credentials
  token, 30s heartbeat, ~55min refresh; working precedent: OpenClaw's Zoom plugin). Send =
  POST /v2/im/chat/messages (markdown + EDIT → streaming-look possible; buttons yes; typing
  no). **Recommended adapter shape: stateful ZoomChannelAdapter owns the socket + buffers;
  pollForInboundMessages drains per tick — zero pipeline change.** No replay on disconnect
  (recorded). Prereqs: 'zoom' in ChannelKind unions + catalog entry + credential-fields
  indirection.
**⏭ CHAD SMOKE (channels): Channels section → rows wear the Telegram brand mark + status pill ·
gear (Manage) → rename → row updates · pill Active↔Paused → polling actually pauses/resumes ·
add your Telegram user ID as allowed sender, then remove (X arms "Sure?") · global menu shows
ONLY global channels, workspace drawer ONLY its own · connect dialog: Telegram card branded,
Discord "coming soon". Then decide: build the Zoom adapter next, or another kind first?**

## (prev) ⏭ NEXT ACTION (2026-07-23 round 3): CHAT-LINKABLE PLAN REVIEW + VIEW/EDIT ON ALL LISTS — gate GREEN 566f/3076t, reviewed (1 REAL bug + all should-fixes FOLDED); NEXT: CHAD SMOKE (below)

**Chad's round-3 ask ("component that can show plan… claude can link it in chat… edit and view
on both lists… fixed width same for task") — built on the round-1/2 arc:**
- **`vynel://plan/<id>` chat links**: MarkdownText (packages/ui) allows the `vynel:` scheme
  (DOMPurify 3.4 default + vynel, comment pins re-derivation on bump); NEW
  `use-app-link-router.ts` = ONE capture-phase document listener in AppShell (case-insensitive
  scheme match, preventDefault before any navigation); the plans prompt section TEACHES the
  link syntax (with a channels-see-plain-text caveat — SessionToolContext has no surface field
  yet, recorded). create_plan returns the id so the model can link immediately.
- **NEW shared `PlanViewDialog`** (ONE instance in AppShell, keyed off NEW `ui.viewingPlanId`):
  plan + live status cycle + its WORK ITEMS (tasks by loose planId, live cycling, n/m done).
  Opened by chat links, list View, and TaskViewDialog's "View plan" chip. Not-found only on a
  SUCCESSFUL read (error gets its own state).
- **View/Edit/Delete on ALL THREE lists** via NEW fixed-width `RowActions` cluster (w-[84px] —
  rows align; hover-reveal, keyboard-discoverable). NEW dialogs: TaskViewDialog +
  EditTaskDialog · EditPlanDialog · JournalEntryViewDialog + EditJournalEntryDialog (+
  use-update-journal-entry). Journal edit/delete stay USER-only (append-only agent contract).
- **REVIEWER'S REAL CATCH (folded + pinned by test): a VIEW dialog must resolve its row LIVE
  from the list query by id — the snapshot-prop version froze the status tile after one
  transition** (second click re-sent the same status). Edit dialogs snapshot deliberately.
  Also folded: regexp comment truth (matrix kept) · case-insensitive scheme match ·
  error-vs-deleted states · dated journal aria-labels · softened link teaching.
  TEST LESSON: a mutable list mock must return `[...rows]` per fetch — returning the cached
  reference defeats vue-query structural sharing and hides updates.
**⏭ CHAD SMOKE (round 3): chat → "plan tomorrow: launch, 3 tasks under it, link it" → reply
carries a clickable plan link → review card opens with work items; tick one off IN the card ·
Plans list → View (same card) / Edit (form) · Tasks list → View → "View plan" chip hops to the
plan card · Journal → View (full text) / Edit (your door) · rows align column-clean across all
three lists.**

## (prev) ⏭ NEXT ACTION (2026-07-23): PLANS + JOURNAL FEATURES SHIPPED — gate GREEN 557f/3034t, reviewed (1 should-fix FOLDED); UI+CLI round 2 shipped same day (see prev entry)

**Chad's ask ("2 new features like task — Plan and Journal"): two net-new leaves on the Tasks
template, notes in docs/module-notes/plans.md + journal.md, learning in
.claude/journal/2026-07-23-plans-journal-features.md.**
- **`@vynel/plans`** (migration `0016_plans`): date-wise plans — `planDate` text YYYY-MM-DD,
  tasks-style status/source/completedAt rule, outbox plan.* events, two-door routes
  (`/workspaces/:id/plans` agent door + `/plans` user door), tools list_plans / create_plan /
  update_plan / complete_plan / list_my_plans (writes mutatingApproved, delete user-only).
  **`tasks.planId` loose text ref landed in the same migration** (additive ALTER, NO FK) —
  create/update/list thread it on BOTH task doors; list_tasks + list_my_tasks take a `planId`
  filter (the reviewer's should-fix: the shared query schema advertised it on the user door
  while the handler ignored it — folded by threading it through listTasksForUser).
- **`@vynel/journal`** (migration `0017_journal_entries`): daily work journal — many dated
  entries per day (entryDate + content ≤8000), day/from/to reads newest-first. **Agent door
  APPEND+READ ONLY** (add_journal_entry / list_journal_entries + list_my_journal_entries on the
  user door) — edit/delete are user-door only BY DESIGN (history stays the user's; pinned by a
  route test asserting PATCH/DELETE aren't mounted on the agent door).
- **Capabilities `plans` + `journal`** (defaultEnabled, catalog + route enum + CapabilityId);
  descriptor gates tools AND prompt sections together — contributeWorkspacePrompt generalized to
  an ordered per-capability section list (tasks → plans → journal, tested). 61 MCP tools
  (was 53). Global root: zero plan/journal tools (router precedent).
- **UI + CLI BUILT (same day, Chad's green light; gate GREEN 562f/3062t, reviewed clean, 2
  should-fixes FOLDED — format-day-label unit tests + TaskStatusControl `noun` prop so plan
  rows stop announcing "task" to screen readers): PlansSection + JournalSection on BOTH scopes
  (day-grouped newest-first via NEW utils/format-day-label.ts — the client owns "today";
  composers default to today; PlanRow REUSES TaskStatusControl — one home for the status
  cycle), sidebar/menu/icon wiring (CalendarRange/NotebookPen), composables/plans+journal
  (vue-query), CLI `vynel plans list|add|done|reopen|move|delete` + `vynel journal
  list|add|delete` over `plansUser`/`journalUser` (day-flag.ts = the shared date-flag home).
  Reviewer nits RECORDED in the module notes (regex admits impossible dates — sweep the
  pattern home next touch · journal 100-row cap needs "load older" first · composer today
  captured at mount · dashboard cards not built).**
**⏭ CHAD SMOKE: restart the app (migrations 0016+0017 apply on boot) · workspace chat → "plan
tomorrow: ship the newsletter, three tasks under it" → create_plan + create_task(planId) fire
uncarded, list_plans shows the day · "what's planned for tomorrow?" → reads back · "log today's
progress in the journal" → add_journal_entry; new session → "what happened yesterday?" →
list_journal_entries range read · Capabilities panel shows Plans + Journal toggles; toggling one
off drops its tools AND its prompt section next turn · **UI: sidebar shows Plans + Journal in
both scopes → Plans: add "Launch day" for tomorrow → appears under a "Tomorrow" header, status
tile cycles, Claude/You chips right · Journal: write an entry → lands under "Today", delete on
hover · CLI: `vynel plans add "Bookkeeping" --date 2026-07-25` then `vynel plans list` ·
`vynel journal add "smoke note"` then `vynel journal list --date <today>`.**

**OVERNIGHT (Chad: "complete the remaining parts and the communication mcp… shutdown… in
the morning I will smoke test"): the session-communications arc built per
docs/module-notes/session-comms.md (forks settled autonomously, all recorded there —
vocabulary=reports-only · addressing=requester-mediated/server-stamped ·
awareness=a REAL turn via the delegation queue · tree topology=no cycles).
Subagent-built + adversarially reviewed; 1 must-fix + 3 hardenings FOLDED (delivery rows
chip-less — the discriminator widened to any attributed inbound row · completed jobs can
never flip failed · complete→enqueue→mark ONE transaction · global deliveries serialize
behind GLOBAL_ROOT_DELIVERY_TARGET_KEY). Migration 0015 job_kind additive. 53 MCP tools
(+report_to_requester, plain workspace array via the new rootSurface:false opt-out; the
global root never has it). recordPushedReportMessage now DEAD in production (delete next
touch). Channel delivery unchanged (completion-time, immediate).**
**⏭ CHAD'S MORNING SMOKE: ① restart the app (migration 0015 applies on boot) · ② global →
send a task to letterman → when it completes, the report arrives as Sarah ACTUALLY
REPORTING IN (an inbound message + the assistant's own reply absorbing it) — not a
detached row · ③ the chain: global → letterman → "have the test session do X" → session
completes → letterman gets the notify turn → Sarah passes the REAL result up via
report_to_requester → your global chat gets the real data as a processed turn · ④ chips:
delivery rows are chip-less; the pipeline drill (trace → session → agent, Back) works ·
⑤ Telegram replies still arrive immediately. DEFERRED overnight (deliberately, recorded):
as-built docs refresh · housekeeping bundle (detached-run lease · tick split ·
onDecideApproval ×3 · AppShell/ThreadStream size) · settings arc · monitor tree · the
UNIQUE chat_sessions.id test flake (seen once, passing reruns — find the fixed-id seed
when it recurs).**

## (prev) ⏭ NEXT ACTION (2026-07-21Q): WATCH PIPELINE SCOPING SHIPPED — `12b90bd`; gate GREEN 2866t, reviewed CLEAN; Chad's issue list PART 1 done

**Chad's "proper instruction" arrived (2026-07-21 evening) as TWO parts, now in
docs/module-notes/sessions-surface.md:**
- **PART 1 BUILT (`12b90bd`): the watch PIPELINE scoping rules** — Global → Workspace →
  Session → Agent; a thread chips ONLY its direct children, never the delegation that
  targeted itself. Discriminator: received trace = this thread holds the key's
  user+global-root task row (the only two writers are the target-side runners — verified
  exhaustive). Session view = agent chips only. Panel = the pipeline drill: trace →
  session (NEW spawnedTargetSession on the trace envelope, tenant-checked) → agent, Back
  walks up; the monitor binds the ACTIVE node's source (baseSource→activeSource refactor,
  reviewer-verified re-arm on Back). RECORDED: mid-turn-swap discriminator edge (notes) ·
  duplicate "Open <session>" chips on multi-reply traces (first-only when it bites) ·
  ThreadStream 376 lines (scroll-windowing extraction next touch) · ONE FLAKY gate run
  seen (UNIQUE chat_sessions.id via handle-session-started under vitest parallelism —
  passed on rerun ×2; find + fix the fixed-id seed when it recurs).
- **PART 2 = THE COMMS ARC (next major work)**: the reverse flow — a child completing
  reports REAL data to its requester (not "routed ✅" + a detached report later); the
  parent is AWARE in its flow and notifies ITS parent up the chain (agent → session →
  workspace → global). Forks to settle at arc-open are listed in the notes.**

## (prev) 🔵 NEXT ACTION (2026-07-21P): ARC SMOKED & CONFIRMED BY CHAD (screenshot: workspace chat → send_task_to_session → the session's report lands BACK IN THE WORKSPACE THREAD attributed + chipped; plain Home/Chat/Sessions menus live; session FIFO explained by Sarah correctly). **CHAD IS PREPARING AN ISSUE LIST "with proper instruction" — the next session's FIRST job is to receive + work that list.** Until it arrives, touch nothing new; the candidate queue (below) waits behind it.

**Candidate queue AFTER Chad's list: ① inter-session comms arc (parked in
docs/module-notes/sessions-surface.md — open with module notes + the forks: message-vs-task
vocabulary, direct addressing vs creator-mediated, reply threading) · ② as-built docs
refresh (.claude/docs stale on the deleted panels/stores of Slices ②–③) · ③ deep monitor
tree (agent.run-* outbox consumers, delegate-to-leaf unparked) · ④ settings arc (default
model + pool cap) · housekeeping bundle (detached-run lease · Telegram 4096 chunking · tick
split · onDecideApproval ×3 extraction · AppShell 430 lines · workspace session-job chips
global-banner-only).**

**Slice ④ (subagent-built, reviewed CLEAN): workspace threads' Watch chips ON (the
show-watch-chips gates DELETED, not flipped) · DIRECT-turn agents watchable —
openAgentDirect(source, toolUseId) generalized, the agent node rides {kind:'session'} for
non-delegated rows (persisted subagent fields render settled; panel derive verified
source-agnostic) · session-target in-flight jobs get banner chips named by the spawned
session (in-flight DTO widened additively: targetPrimarySessionId + sessionName;
attach-spawned-session-names batched enricher; resolveSpawnedSessionDisplayName = ONE home
shared with the tick's attribution; NEW ProcessingBanner.vue extracted byte-equivalent) ·
linked-session chips open the monitor (openSession KEPT, its consumer arrived) ·
ContextMeter DELETED (zero consumers) · chat.getSession gained attachDelegationTaskLabels
(the two detail flavors can't diverge — the Slice-① recorded follow-on closed). RECORDED:
workspace-created session-job chips appear in the GLOBAL banner only (v1, commented) ·
direct-agent chip on an old chain segment binds that segment's channel (settled correct;
one-attach contract) · .gitignore trailing-newline chore.**
**⏭ CHAD FULL SMOKE (the whole arc): workspace thread → delegation rows show Watch · any
chat → an agent runs → its card's Watch chip opens the focused view (live + after reload) ·
send a task INTO a session from global → the banner chip names the session, click → live
trace · click a linked-session chip → the session's live view · plus the 21N re-smoke list
(plain menus, Sessions list, chat-into-session, queued sends, Chat follows scope).**

## (prev) ⏭ NEXT ACTION (2026-07-21N): SESSIONS SURFACE SIMPLIFIED PER CHAD'S LIVE FEEDBACK — `fcc9141`; gate GREEN 528f/2847t, two more review rounds folded; + the chat-menu scope fix `6a376f5`

**Chad's two live-feedback rounds on the shipped ③b, both reworked + reviewed:**
- **"No special menus"**: the segmented Home/Chat pill DELETED — Home, Chat, Sessions are plain
  sidebar MENU rows (both scopes; House/MessageCircle/History icons; aria-current active
  marks; the duplicate GLOBAL_SECTIONS sessions entry died with it; selectSurface = the one
  routing home for rows + Go menu + palette).
- **The Sessions view = the plain two-pane shape** (old Conversations-panel styling): narrow
  list rows (name · time · small % · working dot; chain expansion kept) + the selected session
  as a NORMAL CHAT — ThreadStream + the active-turn fold (use-session-turn switched folds from
  the trace fold; ThreadStream dedupe/scroll free; approvals decidable in-pane). GLOBAL scope
  lists ONLY the root's own children (spawned + workspaceId null); workspace = its conversation
  + its sessions. Row Watch button died (chips still reach the monitor); hero/badges/scope
  labels died; monitor detached from the pane (detail poll 4s while the feed reports a turn).
- **Review folds across the rounds**: mid-turn sends QUEUE via useQueuedSend + chips (were
  silently eaten — ChatComposer clears the draft on emit by contract) · detail-read error =
  said state-note · dead global branches deleted · allowAttachments composer prop (explicit
  withDefaults(true) — a bare optional boolean would have stripped attachments on every chat
  surface; existing tests caught it) · turn errors never blank the transcript · 404 → "session
  moved" · meter/chain pins resurrected. RECORDED: activityMonitorStore.openSession +
  ContextMeter now zero production consumers (Slice ④ decides: watch-from-list returns or they
  go) · onDecideApproval copy #3 (extract next touch) · mid-turn compaction-swap freezes the
  pane until reopened (WHY-commented, ~85% edge) · no unmount abort (server runs to completion
  by design).
**⏭ CHAD RE-SMOKE: sidebar = plain Home/Chat/Sessions rows, no pill · Sessions → list pane +
"Pick a session" → open Letterman Overview → normal chat look, type into it → streams; send
again mid-reply → queued chip → fires · workspace scope: letterman's conversation + its
sessions listed. Then Slice ④ (coverage: workspace Watch chips · direct-turn agent focus ·
session-target chips · linked-session chips → monitor · watch-from-list decision).**

## (prev) ⏭ NEXT ACTION (2026-07-21M): SLICE ③ SHIPPED WHOLE — ③a `448176a` (chat-into-session route + SessionTargetLocks) + ③b `4d05e12` (nav trio + Sessions library + composer); gate GREEN 528f/2849t, both halves adversarially reviewed (0 must-fix; all should-fixes folded)

**③a (subagent-built, reviewed CLEAN): POST /sessions/:sessionId/turn (`sessions.startTurn`,
segment-id handle, SSE chat-turn shape + leading `turn-queued` sentinel) resumes the spawned
HEAD (re-read after parking; deleted-mid-queue clean) with the SPAWNED-target background MCP
set (locked ①; global-grounded = bare) under interactive `ask`-default mode; NO routed-task
steer. NEW `SessionTargetLocks` (FIFO acquire/release, sync registration) SHARED between the
delegation pool (its private Set replaced; sync-claim + release-every-launch pins survive) and
user turns — single-writer per spawned session both directions, TOCTOU-free (reviewer-attacked).
Disconnect-while-parked pinned: the promised turn still runs, the lock frees (hono 4.12 nuance:
real disconnects arrive via body.cancel(), NOT the request signal — the test simulates it
faithfully, commented). startChatTurn widened additively (nullable workspaceId +
newSessionOptions); ground resolution ONE home (resolveSpawnedSessionRunCwd). RECORDED:
composition-before-parking snapshot (one-turn staleness, harmless) · user turns get the
onCompaction hook delegated runs lack (asymmetry noted) · no server interrupt for session turns
(client abort only, consistent with stop_session_task not shipped).**
**③b (subagent-built, reviewed 0 must-fix, 3 should-fixes folded): nav = Home | Chat | Sessions
(both scopes; palette/Go/View menu route through openSessions). /sessions = the routed library
(?workspace=<id> scope; absorbs SessionsSection — DELETED with SessionsPanel +
use-session-list, no shims; locked 0b: the Conversations panel + workspace "New conversation"
affordance died deliberately; global ⌘N fresh path intact). SessionThreadView =
useActivityMonitor + ActivityEntriesList + AppComposer (spawned-head only; segments view-only
+ head hint; primaries route to Chat; agent-scope view-only). use-session-turn = the composer
driver (monitor's fold reused, settle = invalidate sessionKeys.all THEN clear; 404 → "session
moved" message). FOLDED: ChatComposer grew `allowAttachments` (explicit withDefaults true —
bare optional boolean would have stripped attachments everywhere; caught by existing tests) ·
turn errors render beside the composer, never blanking the transcript · the dead
SessionsSection meter/chain pins resurrected. RECORDED (deferred): AppShell 426 lines (split
next touch) · watching-vs-working dot semantics (both surfaces) · spawned working-dot +
scopeKind 'global' announce = the Slice-④ chips item · ShellPreview mock dock permanently open
(preview-only) · as-built docs stale on deleted panels/sections.**
**⏭ CHAD SMOKE (the arc's visible payoff): nav shows Home | Chat | Sessions in global AND a
workspace · Sessions lists everything scope-filtered (meters, chains, working dots) · open
"Letterman – Test Session" → full thread renders (history + live) → TYPE INTO IT → reply
streams; send while a delegated task runs → "queued" note, then it goes · open a chain segment
→ view-only + head hint · View menu → Sessions (old panel gone) · Esc/Back/Watch all still fine.
Then Slice ④ (coverage: workspace Watch chips + direct-turn agent focus + session-target chips
+ linked-session chips → monitor).**

## (prev) ⏭ NEXT ACTION (2026-07-21L): ④b PIN RE-DECIDED + BUILT (`524559d`) — delegated workspace-root turns carry the session-routing trio; gate GREEN 525f/2821t; Chad's chain smoke CONFIRMED WORKING (screenshot: Sarah routed send_task_to_session cleanly)

**Chad's live smoke exposed the residual: a delegated letterman turn couldn't
send_task_to_session (the ④b backgrounds-excluded pin), and the model narrated the
per-origin toolset flip as "dropped again" — blocking his global → workspace → session
chain. RE-DECISION (Chad: "we can continue then", after the mechanism explanation):
delegated WORKSPACE-ROOT turns compose `vynelWorkspaceInteractiveDescriptor` (trio
included) via NEW target-aware `buildDelegatedTurnMcpComposer`; schedule fires +
spawned-session targets stay plain (autonomy boundary; leaves don't recurse). The tick's
composer dep gained `target`; generator/emitted/descriptor comments swept; the
generated-array exclusion pin stays TRUE (opt-in is descriptor-level); routing pinned by
a mocked-descriptor test + the tick's target assertions. Notes updated (decision 0 + 0b:
the View→Conversations sidebar is SUPERSEDED by Slice ③'s Sessions view — Chad's call on
seeing "No past conversations").
⏭ CHAD SMOKE: re-run the exact chain — global chat: "have letterman send the
publication-module overview into the Letterman – Test Session" → Sarah routes it (no
"not available"), the report lands back; PLUS the ② click-through below. Then Slice ③.**

## (prev) ⏭ NEXT ACTION (2026-07-21k): SLICES ①+② COMMITTED (`ecf33c2`+`44a219e`) — gate GREEN 524f/2819t, both reviewed CLEAN; NEXT: CHAD CLICK-THROUGH SMOKE, then Slice ③ (nav Home|Chat|Sessions + Sessions view + the session-turn route)

**Slice ② (subagent-built, adversarially reviewed CLEAN 0 must-fix — behavior + test intents
verified 1:1 against the deleted panels): SessionViewerPanel + SessionWatchPanel + their two
stores DELETED → ONE `components/activity/ActivityMonitorPanel.vue` (+ ActivityPanelHeader /
ActivityEntriesList / AgentFocusView + agent-focus.ts) over
`stores/activity-monitor-store.ts` — a node STACK (trace | session | agent; an agent node
CARRIES its parent ActivitySource; open resets · push/back · openTrace/openSession ·
openAgentDirect = Close-only · focusAgent = Back). One useActivityMonitor(baseSource)
instance; drilling into an agent never re-attaches. Session views GAINED agent drill-down.
The Slice-① thin adapters retired with their last consumers; the 3 load-bearing trace
lifecycle tests recast onto use-activity-monitor.test.ts verbatim. Reviewer folds: stale
chat-turn-stream comment · unused trace-node title field dropped · aria-label per baseKind.
RECORDED (not built): as-built docs still name the deleted panels
(`.claude/docs/_apps/local-web/structure.md`, `docs/desktop-shell-inventory.md`) · Slice ③
may extract the entries list toward @vynel/ui when SessionThread shares it · the settle-
refetch-error overlay guard (inherited nit) still open.**
**⏭ CHAD SMOKE (①+② together, before ③ builds on it): delegate a task → banner chip Watch →
the SAME panel opens with status pill + Stop · click an Agent card's Watch chip → focused
agent view, Close-only; from an open trace click a chip → Back returns · Sessions left-nav →
Watch any session → its HISTORY renders immediately (was an empty pane), a live turn streams
on top, drill into its agent · Esc closes. Then Slice ③ per the notes (nav trio + Sessions
view + POST /sessions/:id/turn with the three locked decisions).**

## (prev) ⏭ NEXT ACTION (2026-07-21j): SESSIONS-SURFACE SLICE ① BUILT (the activity source seam) — gate GREEN 524f/2811t, reviewed (1 should-fix + 2 nits FOLDED); COMMITTED `ecf33c2`

**Slice ① per docs/module-notes/sessions-surface.md: NEW
`apps/local-web/src/composables/activity/use-activity-monitor.ts` — the ONE source seam.
`ActivitySource {kind:'trace'|'session', id}`; settled half = trace read (status-polled) /
FULL transcript via root.getSession (owner-gated, any scope — the watch had NO history
before); live half = the matching SSE fold (applyTraceStreamEvent, unchanged); merge =
settled-wins-by-id + overlay append; settle = streaming-off → refetch → overlay swap; drop
= errorText + poll re-arm; per-kind attach policy (session immediate/one-attach-one-turn
v1 · trace only-while-live). `useSessionWatch` + `useDelegationTraceLive` are now thin
ADAPTERS with byte-identical return contracts — panels untouched, the old lifecycle tests
run unchanged through them (the regression net). CLOSES two recorded gaps: Watch opens
onto history (not an empty pane) + mid-run attach unfreezes via the keep-alive.**
**Reviewer (trace parity CLEAN line-for-line; session lifecycle CLEAN): 1 REAL should-fix
FOLDED — `sessionKeys.detail` was scope-BLIND while the fetch is scope-ROUTED
(root.getSession decorates delegationTaskLabel; chat.getSession doesn't) → a watched
workspace session + its open thread = two fetchers on one cache entry. Key now carries
`sessionScopeKey` (invalidations are prefix-based, unaffected). Also folded: keep-alive
cadence ONE home (TRACE_KEEP_ALIVE_MS exported) + a session-kind re-target test. RECORDED
not built: settle-refetch-error still clears the overlay (inherited from the old trace
code — guard on next touch) · chat.getSession should ALSO attachDelegationTaskLabels so
the two detail reads can't diverge in content (ride Slice ④) · monitor's hasEnded/errorText
unexposed for the trace kind until Slice ② consumes them.**
**⏭ CHAD SMOKE (with ②, or now): open Sessions → Watch any session → its HISTORY renders
immediately; a running turn streams on top; after the turn ends the rows persist. COMMIT:
`feat(web): one activity source seam for watch surfaces (slice 1)`.**

## (prev) 🔵 NEXT ACTION (2026-07-21i): SESSIONS-SURFACE ARC OPENED (notes `docs/module-notes/sessions-surface.md`, Chad approved verbatim) + cf15137 REVIEW DONE & FOLDED — gate GREEN 523f/2806t; TWO separable uncommitted changes awaited commit (DONE: `414621e`+`cec4a38`+`bf7b1f0`)

**cf15137 REVIEW VERDICT (adversarial pass, done): structurally sound end-to-end, 0 must-fix
— migration 0014 truly additive · no unvalidated hop (bogus model can't reach the provider)
· NULL/absent correct at every hop (legacy rows byte-identical) · both target kinds honored
· threading SURVIVED the mcp-attachment work. ONE should-fix FOLDED: the curated model ids
were INVISIBLE to the delegating agent (`.refine` emits a bare string into OpenAPI → the
generated tool schema said `model: z.string()` — the pick half of the feature depended on
guessing post-cutoff ids). Fix: `CHAT_MODEL_IDS` became a const TUPLE in contracts (the
THINKING_EFFORT_LEVELS pattern, + `ChatModelId`; `ChatModelOption.id` narrowed; the two
composer-route refines keep behavior via a `readonly string[]` widen) →
`DelegationRunPreferenceFields.model = z.enum(CHAT_MODEL_IDS)` → api:generate: BOTH send
tools now expose `z.enum(['claude-fable-5','claude-opus-4-8','claude-sonnet-4-6',
'claude-haiku-4-5'])`. + the reviewer's deferred nit: session-route 400-on-bad-model pin
(the shared-fields composition). RECORDED not built: session/delegation runners' inline
effort union = a third structural copy (import ThinkingEffortLevel next touch).
**COMMIT PLAN (two commits, files disjoint): ① the 21h mcp fix
(`fix(session): attach background mcp servers to delegated turns`) ② this fold
(`fix(api): expose the model allowlist as an enum on both send tools`).**

**Chad's arc (confirmed "yes exactly we need that"): nav becomes Home | Chat | Sessions per
scope. Chat = THE continuous primary; Sessions = the library (spawned children + chain fork
segments), each opening a FULL chat-style view — live, and directly chattable at the chain
HEAD. ONE component (`SessionThread` = transcript + live overlay + optional composer) over
ONE source seam (`useActivityMonitor`: settled ∪ live, source kinds session/trace/agent),
drill-down `Session → Session | Agent` as a node stack. LOCKED: ① user turns into spawned
sessions attach the BACKGROUND MCP set (toolset consistency — today's disconnect lesson);
② superseded segments VIEW-ONLY, chat lands on the head; ③ user turns QUEUE behind a
running delegated task (pool FIFO extends). Slices: ① source seam → ② SessionThread +
merged panel → ③ nav + Sessions view + the NEW session-turn route → ④ coverage (workspace
Watch chips, direct-turn agent focus). The deep monitor tree (outbox consumers,
delegate-to-leaf) stays a later arc. Full recon inventory in the notes' Ground section.
SEQUENCE: commit the 21h fix → fold the cf15137 review verdict → Slice ①.**

## (prev) ⏭ NEXT ACTION (2026-07-21h): MCP "SERVER DISCONNECTED" BUG FIXED — gate GREEN 523f/2806t, reviewed CLEAN 0 must-fix; NEXT: Chad smoke (delegate → tools survive) → COMMIT → then the deferred cf15137 review

**ROOT CAUSE (verified empirically from the letterman CLI transcripts, NOT the STATE suspects):
the server never crashed. A DELEGATED background turn (`delegateToWorkspaceRoot` /
`delegateToSpawnedSession`) resumes the SAME SDK session as the interactive chat with ZERO MCP
servers (delegation-service's documented "does NOT compose @vynel/mcp"). Under SDK 0.3.213 MCP
tools are DEFERRED tools reconciled per turn on the resumed session: the bare delegated turn made
the CLI strip every `mcp__vynel*` tool and inject "deferred tools are no longer available (MCP
server disconnected) … Do not search for them" — so the workspace brain honestly told Chad the
whole server was offline, and the belief persisted into later turns. The transcript
(`0254dbc3….jsonl`) shows `deferred_tools_delta` REMOVE-all at each delegated turn ("Quick test
task…" 00:08, the re-sent create-session asks 01:57/01:59) and ADD-back at each interactive turn
(01:08, 01:41). Suspects ①(handler throw — generated handlers are fully try/caught) and
②(workspaceId stamping) RULED OUT; ③ the SHADOWED warning is orthogonal + benign (the floor cards
via the PreToolUse hook, never canUseTool — expected noise, no action).**

**FIX (schedule-fire parity, subagent-reviewed CLEAN): delegated turns now attach the SAME
background workspace MCP set schedule fires attach.**
- **NEW `apps/local-api/src/sessions/build-workspace-background-mcp.ts`** — ONE home:
  `buildWorkspaceBackgroundMcpComposer(appRequest)` composes `[vynelWorkspaceDescriptor,
  notebookFeatureDescriptor]` capability-gated; `buildScheduleFireDeps` refactored onto it
  (reviewer: byte-identical composition, still pinned end-to-end).
- **NEW `packages/session/src/delegation/routed-turn-provider-input.ts`** — ROUTED_TASK_INSTRUCTIONS
  moved here + `RoutedTurnMcpAttachment` (structural mirror of ComposedSessionMcpServers — the leaf
  never imports @vynel/mcp) + composeRoutedTurnSystemPrompt + routedTurnMcpSessionFields (both
  runners spread it; no-attachment = byte-for-byte the old bare shape).
- **Tick** grew optional `composeWorkspaceMcpServers` dep; grounding: workspace job → its
  workspaceId · workspace-grounded spawned target → the spawned primary's OWN workspaceId (gains
  its ground's toolset on first task — adding is safe, stripping was the bug) · global-grounded
  spawned → NOTHING (bare stays forward-consistent; the tick is the only resumer of spawned
  primaries). delegation-service REQUIRES the composer; server.ts builds + injects it.
- **Tests:** attachment threading pinned in both runner tests, per-target grounding + negatives in
  the tick test, dep pass-through in the service test. 6 new tests.
- **KNOWN RESIDUAL (by design, recorded):** interactive-only features still detach on a background
  turn — the session trio (create/list/send) reads "tool removed", the ask + ssh SERVERS read
  "disconnected" in the delta. Honest (they genuinely aren't available in background turns) and
  small; revisit only if the model over-reacts in practice.
**⏭ CHAD SMOKE: restart the api → from GLOBAL chat delegate any task to letterman → when it
completes, ask the letterman workspace chat "list your vynel tools / list_sessions" → tools present,
NO "disconnected" claim (previously every delegated turn killed them) · send a task to a spawned
session → same check on the global side · schedule fires unchanged. Then COMMIT
(fix(session): attach background mcp to delegated turns) + changelog. THEN the deferred cf15137
adversarial review (2026-07-21g item) still stands.**

## (prev) NEXT ACTION (2026-07-21g): DELEGATION MODEL+EFFORT PICKS SHIPPED — gate GREEN 2803t; ⚠ REVIEWER PASS DEFERRED to next session (context limit) — run code-reviewer on `git show HEAD` first thing

**Chad's follow-up: the root now picks `model` + `thinkingEffort` PER DELEGATED TASK on BOTH
send tools (workspace + session). Migration `0014_delegation_model_effort` (two additive
ALTERs, verified no-recreate); enqueues store; routes validate (CHAT_MODEL_IDS refine +
THINKING_EFFORT_LEVELS enum, shared field object); tick threads via sharedRunnerOptions into
both runners → StartChatSessionInput (fields existed since the composer seam). Omitted =
defaults, pinned. Tool descriptions teach cost economics (cheap model/low effort for routine).
7 new tests. Subagent-built; scoped 619 + full gate green; the adversarial review is the ONE
outstanding item — do it before building anything on top.**

## (prev) ⏭ NEXT ACTION (2026-07-21f): SLICE 4b WORKSPACE-LEVEL SPAWNING BUILT — gate GREEN 2798t, reviewed APPROVED (1 test-pin folded, 1 surface decision RECORDED); NEXT: Chad's big smoke (both levels) → candidates: monitor arc · detached-run lease

**Slice ④b (Chad: "available on the workspace level as well") — notes §4b, subagent-built +
adversarially reviewed:** createSpawnedSession/segment thread optional workspaceId (ground =
the workspace's cwd/memory; global unchanged) · tools reach WORKSPACE interactive streams via a
NEW generator surface flag `workspaceInteractiveSurface` → third array + vynelWorkspaceInteractiveDescriptor,
composed ONLY by chat-turn stream + /context mirror (backgrounds structurally excluded, pinned) ·
routes take ownership-checked optional workspaceId (guard = active creator conversation; parent =
the workspace primary's sdk id) · **reports route to the CREATOR** (spawned primary's own
workspaceId → that workspace's conversation; global → root; missing creator falls through, job
still completes). **THE BUILD CAUGHT TWO REAL SLICE-④ BUGS:** the workspace liveness index
collided with workspace-spawned primaries (migration `0013_spawned_workspace_grounding` — index
drop/recreate scope-gated to 'workspace', reviewer-verified rows untouched) + a spawned row could
MASQUERADE as the workspace brain in findPrimarySessionForWorkspace (scope filter added; swept =
only workspaceId query site; deterministic insert-order pin folded per reviewer). **DECISION
RECORDED (notes):** workspaceId stays MODEL-VISIBLE on both surfaces — it's how the global root
spawns workspace-grounded sessions; ownership 404 is the gate.
**⏭ CHAD SMOKE addendum: from a WORKSPACE chat — "create a session for X" → the entry lists
under that workspace name · its report lands in the WORKSPACE conversation · from GLOBAL —
"create a session in <workspace> for Y" → grounded there, report to global.**

## (prev) NEXT ACTION (2026-07-21e): SLICE 4 SESSION TOOLS BUILT — COMMITTED `22b0460`+`1d1326b`

**Slice ④ built per docs/module-notes/session-tools.md (subagent-built, independently
adversarially reviewed; the notes carry the as-built decisions + reviewer nits):**
- **'spawned' scope** on BOTH unions (TS-only, no migration; many-per-user — deliberately no
  liveness index). UI label "Session"; overview lists spawned entries natively.
- **createSpawnedSession** (`@vynel/session/spawned`): the priming-seed rails reused
  (runSeededSwapSession w/ purpose-as-seed) → primary scope 'spawned' + linked + NEW
  recordSpawnedSessionSegment (listed, title=name, workspaceId NULL, outbox co-commit).
  Ground = the global root's hidden cwd (fork: inherits creator; v1 global-root-only).
- **Queue generalized — migration 0012_delegation_session_targets** (TABLE RECREATE:
  +nullable targetPrimarySessionId, 3 workspace cols→nullable; **drizzle's generated INSERT
  SELECT was BROKEN — selected the new column from the old table — hand-fixed**; reviewer
  proved the round-trip empirically on a fresh DB: rows byte-identical, indexes/FKs/cascade
  intact). enqueueSessionDelegation (exactly-one-target); claim exclusion NULL-SAFE across
  both columns (bare NOT IN would drop every row with a NULL column — the isNull disjuncts);
  pool key = activeTargetKeys (the recorded Slice-② rename landed).
- **delegateToSpawnedSession** — line-for-line parity with the workspace runner (shared
  pipeline, swap-safe resume of the spawned primary's CURRENT sdk id, mid-turn swap link,
  stop-wins, breaker, feed scopeKind 'global', session-channel tee); both-null legacy rows
  fail cleanly (never stuck claimed); orphaned-target → failed (tested).
- **Tools (routing surface, global-root streams only v1):** create_session (POST
  /sessions/spawned, UNCARDED — Apps precedent, structurally verified) · list_sessions
  (x-mcp on GET /sessions/overview — the model reads the SAME context numbers the panel
  shows) · send_task_to_session (POST /routing/delegate-session). **stop_session_task
  DELIBERATELY NOT SHIPPED** (the stop route keys on partialSessionId which the model never
  holds — notes reconciled; human stop covers session jobs, tested). 52 MCP tools, parity
  pins updated.
- Reviewer nits RECORDED in the notes (stale create-handle after swap — list_sessions
  recovers · name fallbacks differ route-vs-tick · " · " in a name vs the color-key parse ·
  tick 433 lines · create's 3 writes not one tx). Earlier same-day: model picker grew
  FABLE 5 + thinking picker widened to ALL FIVE SDK levels (`a6d061e`, Chad); default-model
  SETTING recorded for the settings arc.
**⏭ CHAD SMOKE (the arc's payoff): in global chat — "create a session to research X" → a
"Session" entry appears in the Sessions panel (named, metered) · "send that session a task"
+ delegate to a workspace simultaneously → both run (pool), reports arrive distilled ·
same-session double-send → FIFO · Watch the spawned session's live turn · ask "which
sessions are running low on context?" → the model reads list_sessions' numbers. Then the
follow-on candidates above.**

## (prev) NEXT ACTION (2026-07-21d): SLICE 3 SESSIONS PANEL BUILT — COMMITTED `0822f3b`+`4972d22` (+ picker catalog `a6d061e`)

**Slice ③ built per docs/module-notes/sessions-panel.md (all four forks = my recommendations,
Chad-approved; + his composer follow-up §5). Five parts:**
- **DATA (migration 0011_session_context_chain, drizzle-generated, additive):** chat_sessions
  grew `lastContextTokens` (the occupancy mirror — handle-usage-reported writes it beside the
  per-message write, model merged into the same update) + `continuedFromSessionId` (the chain
  link — recordSwapSegmentSession stamps it; bridgePrimarySession's startSeededSession dep
  gained the fromSdkSessionId param). `resolveContextWindow` ALREADY EXISTED in contracts —
  the window map was free.
- **API:** `@vynel/session/overview` getSessionsOverview (ONE home — the panel route now, the
  Slice-④ list_sessions tool later): chain folding (newest-first-wins on corrupted duplicate
  children — reviewer should-fix; cycles terminate + drop silently, tested), fork-B "Assistant"
  surfacing of the hidden global chain, hidden-workspace-chain doorway rule, last-known-model
  window fallback (a fresh swap segment reports no model — a 1M chain must not meter as 200k).
  Route GET /sessions/overview (`sessions.overview`), contracts sessions-overview.ts.
- **WATCH EVERYWHERE:** `session-turn-channel.ts` (sessionChannelKey + the tee wrapper, keyed
  from the FIRST frame — user-message-persisted carries the id nested) wired INSIDE the three
  core runners (startChatTurn / runGlobalRootTurnCore / delegateToWorkspaceRoot — optional
  turnEvents deps) → all five surfaces publish (web ws, global web/voice, channels, schedules,
  delegations; a delegated turn publishes trace + session keys, disjoint namespaces). SSE route
  GET /sessions/:sessionId/stream (ownership 404, one attach = one turn, turn-stream-ended;
  server-side tests folded per reviewer).
- **THINKING:** the SDK grew FIRST-CLASS `options.effort` (EffortLevel low/medium/high/xhigh/
  max) — no budget table; contracts thinking-effort.ts (picker Auto/High/Medium/Low),
  StartChatSessionInput.thinkingEffort → buildClaudeSdkOptions, both route schemas + streams;
  Auto = omitted, pinned byte-for-byte. Background turns stay Auto.
- **UI (subagent, verified LIVE against the real backend, 0 console errors):** Sessions
  left-nav section (global-only, like Account) — unified list, ContextMeter (amber ≥70%, 85%
  tick), working dots from the activity feed, chain expansion `A ──83%──▶ B (current)` (the %
  = predecessor's fork-time occupancy), Watch via a NEW minimal SessionWatchPanel (the
  delegation viewer is welded to partialSessionId — didn't compose; reuses fold-trace-stream
  unchanged); composer ContextRing (settled + live usage ticks; resets on swap) + Thinking
  SelectChip (ui-store persisted fail-closed). session-keys nests overview under sessionKeys.all
  → every existing turn-end invalidation refreshes it free.
- **RECORDED (reviewer nits, not built):** two tabs racing one session share the channel (first
  end closes the watcher early — no leak, v1-fine) · trace-route safety timer not carried (idle
  attach waits by contract) · cycle corruption drops silently (a fold-time warn if it ever
  bites) · chain-segment click-to-transcript deferred · agent-scope working dots await Slice ④ ·
  pre-existing sessions meter-less until their next turn (expected).
**⏭ CHAD SMOKE (Slices 2+3 together): open Sessions in the left nav → the Assistant row + your
workspaces listed by last use, context meters on sessions with recent turns · chat until a chain
exists (or drop VYNEL_CONTEXT_PRESSURE_THRESHOLD) → the entry expands showing A ──%──▶ B ·
composer shows the ring ticking during a reply + the Thinking chip persists across restarts ·
delegate to two workspaces → both run at once, Sessions rows show working dots, Watch streams a
NON-delegation turn live · same-workspace double-delegate → second queues. Then COMMIT + Slice
4 module notes (create_session/list_sessions/send_to_session/stop_session over the generalized
queue).**

## (prev) NEXT ACTION (2026-07-21c): SLICE 2 CONCURRENT DELEGATIONS BUILT — COMMITTED `5b44a76`+`6de7fda` (+ rename `7ab3f70`)

**Slice ② built per docs/module-notes/concurrent-delegations.md (all forks Chad-approved; the
notes carry the locked decisions + the reviewer's as-built observations):**
- **Bounded pool** replaces the serial inFlight guard (delegation-service): cap
  MAX_CONCURRENT_DELEGATIONS=3 (ONE named home — Chad's plan makes it a user setting later),
  capacity-fill per 1s tick. **Invariant: never two live runs per workspace** (single-writer per
  conversation — the workspace-side root-turn-lock analogue): in-memory activeWorkspaceIds +
  `claimNextPendingDelegationJob` grew optional excludeWorkspaceIds (FIFO holds per workspace;
  parallelism across workspaces only). The pool leans on the tick's SYNC-claim contract
  (claim + onRunStarted before the first await) — regression-pinned by a synchronous test
  assert + the release-finally attaches to EVERY launch (reviewer should-fix: a late claim can
  never leak a slot).
- **Delegations announce on the activity feed** (tick deps grew REQUIRED activityFeed; origin
  'delegation' added to SessionTurnOrigin — additive, no exhaustive switch anywhere): begin
  immediately-before-try (zombie doctrine), sessionResolved composed with the cancel handle,
  end in the outer finally (throwing turn included, tested). Workspace views light up + poll
  live for delegated turns FOR FREE (scope-keyed); the global banner never sees them
  (workspace-scoped). REVERSES the 19-slice "delegations stay off the feed" deferral — that
  poll only ever covered the global side's chips.
- **Reviewer CLEAN**: pool arithmetic no-leak/no-double-free · 3-way interleave audited (no
  shared mutable state; report-push is one sync block; stop keyed per partialSessionId) ·
  RECORDED (in the notes): the timed-out DETACHED turn outlives its exclusion entry (a
  follow-up job can run beside it — pre-existing hole, needs a detached-run lease slice) ·
  tick file 358 lines (split next touch) · as-built docs still name route_to_workspace.
- **Also this session: `route_to_workspace` RENAMED `send_task_to_workspace`** (Chad; parallels
  send_to_channel, preps Slice-④ send_to_session) — x-mcp source + prompts (global-root.md) +
  api:generate regen + fixtures; committed `7ab3f70` on a green gate.
**⏭ CHAD SMOKE (Slice 2): delegate tasks to TWO different workspaces back-to-back from global
chat → both run at once (two Watch chips live; both workspace views show the busy dot + live
thread) · delegate two tasks to the SAME workspace → the second waits for the first · open a
workspace view while a delegated task runs there → thread grows live without Watching. Then
COMMIT + Slice 3 module notes (sessions panel: persist context occupancy per session, the
unified last-used-sorted list, continuity chain view, Watch everywhere).**

## (prev) NEXT ACTION (2026-07-21): SESSION-LIBRARY ARC OPENED + SLICE 1 (CANCELLED-REAP) BUILT — COMMITTED `7327ebb`+`6b71eaa`; denied-wire follow-on COMMITTED `27a952f`+`7d20f40`

**Chad opened the session-library arc (product decisions in memory
[[session-library-product-decisions]]): sessions as a ROOT TOOL (create/list/send-task/stop +
per-session context usage so the root plans and stays context-free) · continuity chains VISIBLE
as THE feature (the 0.85 pressure-swap already runs; the arc surfaces A→B forks) · unified
sessions panel, ALL sessions sorted by last-used, Watch everywhere · archive deprioritized.
Ground mapped by 3 explorers: delegation is global→workspace ONLY, STRICTLY SERIAL (inFlight
guard in delegation-service); delegate-to-leaf-session PARKED no-caller; NO follow-up-message
path into a running child (stop/interrupt exists); agent.run-*/session.delegated outbox events
published but CONSUMERLESS (no monitor); context usage measured for the swap then DISCARDED
(nothing persists occupancy); supersededFromSdkSessionId is ONE-hop (full chain = recorded swap
segments by time). SLICE ORDER (Chad-aligned): ① cancelled-reap bug ② concurrent delegations
(+ delegation turns announce on the activity feed) ③ sessions panel + persisted context
occupancy + chain view ④ session-library tools (generalize the delegation queue to session
targets). Module notes per slice before building ②–④.**

**SLICE 1 BUILT (the stuck-"running"-card bug — the 19h follow-up): ToolCallStatus 'cancelled'
had ZERO writers; the only exit from 'started' was tool-use-completed, so disconnect/app-exit/
interrupt stranded rows forever (Chad had an Agent card stuck a full day). Fix mirrors the
approvals reapAllPending pattern, UI needed NOTHING (card renders 'cancelled' muted; settled
parent already coerces children):**
- **Repo:** `cancelStartedChatToolCalls` (turn-scoped ids, guarded `WHERE status='started'` — a
  completion that raced teardown wins) + `reapAllStartedChatToolCalls` (boot) in
  chat-tool-calls.ts.
- **Consumer:** consume-session-event-stream.ts `for await` wrapped in try/finally; the finally
  cancels the turn's still-open cached rows — ONE home covering all 3 runners AND the
  SSE-disconnect `.return()` teardown. Reap itself best-effort (must not mask the turn's error).
- **Boot:** server.ts reaps beside the approvals boot reap (best-effort, boot must not die).
- **Tests:** repo guard/idempotence + 3 teardown shapes (abandoned iteration via break,
  interrupt with completed sibling untouched, stranded Agent call w/ lean entries staying
  'started' — the UI-coercion contract). One old test RECAST ('started' after stream-end WAS the
  bug; comment explains).
- **Reviewer CLEAN, 0 must-fix**; folded: boot reap try/catch symmetry + finally-reap catch.
  RECORDED follow-up (spawn-task chip): **'denied' is now the zero-writer status** (+
  approvalStatus column never written) — wire the denial write in approval-resolved or trim.
**⏭ CHAD SMOKE: restart the app → the stuck-since-yesterday Agent card in Ks Tournalink reads a
muted "cancelled", no breathing dot · kill the app mid-agent-run, reopen → card settles cancelled
on boot · Stop a turn mid-tool → the tool card settles. COMMITTED `7327ebb`+`6b71eaa` →
Slice 2 module notes (docs/module-notes/concurrent-delegations.md).**

**FOLLOW-ON (same day): 'DENIED' WIRED (the reviewer's same-pattern catch — the next zero-writer
status) — gate GREEN 511f/2714t, reviewed CLEAN 0 must-fix. SDK 0.3.213's canUseTool options
carry `toolUseID` (the per-call tool_use id), which closed the recorded foundation-hardening gap:
approval events (ApprovalRequested/Resolved) grew optional `toolUseId`; the Claude callback
threads it; handle-approval-requested's audit row now carries the REAL tool_use id
(`event.toolUseId ?? approvalRequestId` — placeholder era over, JOIN onto chat_tool_calls works).
Consumer grew per-turn `approvalStatusByToolUseId`: approval-resolved stamps `approvalStatus`
(decision.kind maps 1:1) + a DENIAL settles the row `status='denied'` terminally (the trust card
says "you refused it", not "it broke"); the SDK's post-denial error tool_result can no longer
flip it 'failed'; all 3 event orderings covered (parked-decision insert · mid-flight update ·
echo-overwrite). Denied is terminal → never reaped. UI/contracts needed NOTHING (both verified
present end-to-end). RECORDED nits (not built): resolve-time denial doesn't yield a wire event
(live card settles on the prompt deny echo — yield at resolve = instant settle) ·
consume-session-event-stream ~431 lines (extraction next touch) · doc drift
`.claude/docs/approvals/structure.md` ("outbox consumer" → the shipped in-stream mechanism) ·
revisit the wasDenied guard if a live in-turn approval TIMEOUT ever lands (same trust argument).**

## ⏭ NEXT ACTION (2026-07-20): EDITABLE SESSION-INSTRUCTION MD — gate GREEN 506f/2678t, reviewed COMPLETE, COMMITTED; NEXT: Chad smoke (edit a prompt file + restart) → then the DB/UI arc when Chad wants it

**Chad's "at first" step of the instructions arc: the 3 always-on session-identity prompts left
`@vynel/session/runtime` as TS string literals and became EDITABLE markdown in the `@vynel/instructions`
leaf — `session-instructions/{global-root,workspace-agent,voice-turn}.md`, each file body IS the prompt.
New loader `src/session-instructions/load-session-instruction.ts` (readFileSync + per-id cache + fail-loud)
reached via a dedicated SDK-FREE subpath `@vynel/instructions/session-instructions` (the `@vynel/asks/mcp`
split precedent) so session (spine→leaf) pulls only the fs loader, NEVER the notebook MCP descriptor's
claude-agent-sdk builder graph. Consumers compose-session-capabilities.ts (workspace-agent) +
run-global-root-turn-core.ts (global-root + voice-turn) call the loader; 3 old constant files deleted, the
load-bearing routing-tool guard moved into the loader's colocated test. FAITHFUL: reviewer proved all 3
`.md` byte-identical to the old constants (LF-clean, `.gitattributes eol=lf`). Scope DELIBERATE — session-
identity prompts only; per-feature standing lines (notebook/tasks/ask/desktop) stay with their features
(a feature owns its own prompt). Cache = restart-to-apply (verified-notebooks parity), not hot-reload.**
**⏭ CHAD SMOKE: edit a word in `packages/instructions/session-instructions/workspace-agent.md` → restart
the app → a workspace chat reflects it. FOLLOW-UPS (recorded, not done): refresh as-built docs still
naming the deleted paths (`.claude/docs/session/structure.md`, `docs/module-notes/session.md`); the bigger
DB-backed + in-app-editing arc (the `mode:'always'` column on instruction_documents is reserved for it).**

## ⏭ NEXT ACTION (2026-07-19k): DISTILL WALLS GET ONE HOME — gate GREEN 506f/2675t, reviewed CLEAN; NEXT: commit (Chad picked this hardening; reviewer-checklist teaching = option 3, deferred by Chad "later")

**Closing the CLASS behind the 19i reviewer catch (empty allow-list ≠ no tools). NEW
`run-claude-distill-turn.ts` = THE home for ephemeral text-distills; its walls are NOT
caller-configurable: maxTurns 1 · `options.tools = []` (the SDK kill-switch — the header
documents the footgun + the 2026-07-19 catch) · persistSession false · bypass (safe: no tools
exist to permit) · null-on-failure w/ caller failureLogMessage. Both summaries are now thin
prompts over it (prompts byte-identical — reviewer diffed vs HEAD). `SummarizeSessionInput`
DELIBERATELY LOST permissionMode/allowedToolNames/deniedToolNames (walls are the provider's
job, not a caller choice); sole caller (bridge-primary-session-after-turn) updated.
`runClaudeContextReport` deliberately NOT a caller (documented in the home's header): /context
is a local command (no model call = no injection surface) whose report must reflect the
session's FAITHFUL tool/MCP shape — tools:[] would falsify the measurement. Walls test pins
bypassPermissions/tools/persistSession/maxTurns once; caller tests keep their wall pins as
route-through regression defense. The 19c-era commits through 19j are PUSHED (`2bcaa24..515d3d8`).**

**Review folded: ① MUST-FIX — an empty-string `command` was promoted OUT of the JSON pane but
rendered NO terminal line (falsy v-if): the trust card would approve a Bash call with its empty
command invisible. commandText now requires non-blank; an empty command stays visible in the
JSON pane (+pin test). ② copy fidelity — PayloadView carries `copySource` (the RAW unwrapped
text): the JSON round-trip can corrupt >2^53 integer literals, and copy must never paste a
corrupted value (display keeps the pretty view). ③ the CodeBlock overrides compound with its
root class (`.payload-code.code-block`) — outrank by specificity, not CSS emission order.
RECORDED nits (not built): ToolCallDetail at ~410 lines → extract a PayloadPanes child next
touch · a tool whose `description` field is DATA (not an explanation) gets promoted to the
approval headline — design observation, nothing hidden.**

**Chad (after confirming 19i): ① tool-card Input/Result panes = colored JSON. ② approval card =
prettier + the input's `description` as the title. Built:**
- **ToolCallDetail payload panes render through CodeBlock (shiki json, dual-theme)** for object
  payloads; plain strings stay plain. **MCP text-content results unwrap**: `[{type:'text',text}]`
  → the text; text that IS serialized JSON → the object, pretty-printed (kills the
  escaped-quotes wall in Chad's screenshot). Copy button follows the unwrapped view.
- **ApprovalCard: `description` promotes to the HEADLINE** ("Inspect sibling derived-state
  schemas"), the mechanical "Your assistant wants to…" sentence demotes to a context line; a
  shell-command approval shows `$ <command>` as a terminal line; ALL remaining input fields
  render as colored JSON — the trust card omits nothing, it's just legible. String inputs keep
  the plain pane. Compact (notifier) captures capped.
- Tests: ApprovalCard 3→6, ToolCallCard payload tests recast to the colored-pane spec + the
  unwrap pin.
**⏭ CHAD SMOKE: expand a route_to_workspace card → Input/Result are colored JSON, the Result
shows the object (no \" escapes) · trigger a Bash approval with a description → the description
is the title, the command reads as a $ line · check the compact notifier card too. Then COMMIT
THE DAY (feat(chat) 19h · feat(ui) ticker · feat(session) 19i · feat(ui) 19j · docs).**

**Review round folded: ① the reviewer's sharp catch — `allowedToolNames: []` means NO RESTRICTION
in buildClaudeSdkOptions, so the "toolless" distill actually ran the full claude_code toolset
under bypass (read-tools silently executable = an indirect-injection egress channel over
delegate-produced text). Fixed with the SDK's true kill-switch `options.tools = []` (+ pin
tests), SAME-PATTERN SWEPT into run-claude-session-summary (the swap carry had the identical
hole). ② distill fail-open now ENFORCED (local .catch → null — a throwing third-party provider
would have failed a COMPLETED job via the outer catch) + empty-string distill guard. ③ the
FOURTH structural stub (providers/test-support) grew the method; SummarizeReportCall now derives
via Parameters<AiAgentProvider['summarizeReport']>[0] (drift-proof). RECORDED follow-ups (not
built): tick at ~325 lines — extract the completed-branch composition next touch · the
completion-time origin resolve predates the distill await (stale-channel window during a slow
distill; pre-existing shape) · Telegram adapter has NO 4096-chunking — the fail-open full-report
path can 400 at send (pre-existing; this slice strictly reduces frequency; adapter chunking is
its own slice).**

**Chad (after confirming 19h live): the global chat showed the workspace's ENTIRE report verbatim
(and Telegram got the same wall of text). Wanted: workspace reports to global; GLOBAL composes
what the user reads — a summary in the chat, channel-formatted for a channel origin. Built on the
house one-shot-distill precedent (runClaudeSessionSummary + the swap's haiku):**
- **Provider seam grew `summarizeReport`** (additive, null default — the summarizeSession shape;
  input NOT in the barrel, flows structurally like its sibling). Claude impl
  `run-claude-report-summary.ts`: FRESH ephemeral dispatch (no resume; report+task ride the
  prompt), maxTurns 1, persistSession false, no tools, provider-owned cheap default
  'claude-haiku-4-5'; per-target format rules (chat prose · telegram plain-text <900ch ·
  discord light-markdown <1500ch); manager's voice; null-on-failure.
- **The delegation tick distills once per completed job** (only when the report >700 chars —
  REPORT_DISTILL_MIN_LENGTH; short reports deliver as-is) and uses the reply for BOTH the global
  push row and the channel delivery. **Fail-open: null distill → the full report** (the user
  never loses the answer). `completeDelegationJob` + the workspace transcript KEEP the full
  report — the Watch trace stays the full-detail home (19h's persistence makes that real).
  Origin resolve consolidated to one completion-time read feeding distill-target + delivery.
  Stop-wins ordering untouched (a cancelled run never distills).
- **Sweep:** three structural `as AiAgentProvider` test stubs grew the method; FakeAiAgentProvider
  gained `reportReply` + captured `SummarizeReportCall`s (required-fields mirror of the
  unexported input). Tick tests: distill-long / fail-open / short-skips / channel-target
  ('telegram' + same reply both surfaces). NOTE: the trace's reply/report rows no longer carry
  identical bodies, so collapse-trace-echo shows BOTH in the Watch panel (full reply + the short
  surfaced report) — honest, recorded.
**⏭ CHAD SMOKE: delegate something report-heavy from global chat → the report row reads as a few
sentences (Watch still shows the full detail) · message the Telegram bot with a workspace task →
the Telegram reply is short plain text · a trivially-short task reply arrives unchanged.**

## ⏭ NEXT ACTION (2026-07-19h): AGENT ACTIVITY PERSISTS + IN-THREAD TICKER — reviewed CLEAN (1 should-fix FOLDED); NEXT: Chad's smoke → commit

**ROUND 2 (Chad's screenshot): the full activity list nested under every Agent card floods the
thread when agents run in parallel — "keep only the last one, while active only; the rest under
Watch." ToolCallList's nested AgentActivityPane REPLACED by a one-line live TICKER: presence dot
+ the agent's LATEST action ("Grep pricing…"), "Working…" before the first tool, rendered ONLY
while the Agent call is status='started' with a live map entry. A settled card shows NOTHING
in-line — the full pane now renders ONLY in the Watch focused view (live map or the persisted
fields; after-complete parity intact). `describeAgentActivityCall` extracted to
ui/tool-cards/subagent-activity.ts (one home, pane + ticker). ToolCallList's settled-derive
fallback REMOVED (the focused view keeps it); ticker tests replace the nesting tests. Recorded:
a DIRECT turn's settled agent still has no in-thread activity view (no chip, no trace channel —
its persisted fields await the monitor arc; live it gets the ticker). Delta review CLEAN, folded:
stale trace-live comment · flex-ellipsis inert on ticker + pane rows (span-wrapped, same-pattern
sweep) · mid-run reload ticker falls back to the persisted latest action (+test). Deferred nit
(recorded): AgentActivityLike types live in the .vue while the logic lives in tool-cards/ — a
benign type-only cycle; move types into subagent-activity.ts next touch.**

**Chad's parity check on 19d–19g: the task trace is watchable realtime AND after complete; agent
activity must match, one shared component. Audit verdict: realtime + shared-component halves were
REAL (AgentActivityPane is the one home, fed by the same wire events in thread/panel/focused view);
the after-complete half was NOT — agent activity was live-only by design (persisted nowhere), so
settle/reload dropped the pane, the focused view degraded to report-only, and a mid-run Watch
attach missed all pre-attach activity. Root cause: task-trace rows persist, agent events didn't.**
- **chat_tool_calls grew `subagentNarrative` (text, per-chunk SQL append like message body) +
  `subagentToolCalls` (json, LEAN entries — name/input/status/timestamps, NO outputs; the pane
  never renders them). Migration `0010_subagent_activity`, additive, applies on boot.**
- **Consumer: new `record-subagent-activity.ts`** (per-turn recorder; honors the recorded 369-line
  split-next-touch nit) — marked events persist onto the spawning Agent call's row AND yield the
  unchanged wire events; the Agent call's own completion sweeps lingering 'started' entries to
  'completed' (the subagent returned); unknown parent → warn once, still stream.
- **Contracts/SDK: ChatToolCallResponse/Schema += optional-nullable subagent fields** (the
  delegationTaskLabel additive precedent); SDK regenerated.
- **UI: `deriveSettledAgentActivity` (@vynel/ui tool-cards, one home)** — persisted fields → pane
  shape; child stuck 'started' under a settled parent coerces to 'failed' (no breathing dot on a
  dead run). **ToolCallList falls back to it when the live map lacks the key** → settled threads,
  reloads, and the reopened Watch panel all nest the pane with ZERO per-host wiring; the settle
  reflow violation (pane vanishing) is gone. SessionViewerPanel's focused view gets the same
  fallback. Old "persists NOTHING" consumer test recast as the unknown-parent case (deliberate
  spec change; subagent rows still never touch the main transcript — pinned).
- **Reviewer: CLEAN, 0 must-fix.** 1 should-fix FOLDED (+test): the settle sweep now settles
  lingering entries by the PARENT's outcome — 'failed' when the Agent call errored (was:
  unconditional 'completed', a false green checkmark under a dead run) — stamped with the
  parent's completedAt, not wall-clock. Nits recorded, not folded: activityFor double-call per
  card (allocation-only), no started-dedupe in the recorder (provider normalization precludes).
- **KNOWN LIMIT (recorded):** a mid-run Watch attach still shows only post-attach live activity
  until the settle refetch swaps in the persisted copy (overlay-wins doctrine; full offset-merge
  is a follow-on). `delegate-to-leaf-session` (workspace→SESSION spawning) remains PARKED for the
  Phase-3 monitor arc — today's only live spawn path is the SDK Agent/Task tool, now covered.
- **⚠ FOLLOW-UP (reviewer, pre-existing + now amplified): NOTHING ever writes ToolCallStatus
  'cancelled'** — a turn interrupted/killed before a tool completes leaves the row 'started'
  forever (the Agent card breathed forever before this slice; the nested pane now inherits it,
  since deriveSettledAgentActivity sees a live parent and keeps children 'started'). Needs the
  approvals-style boot/interrupt reap ('started' → 'cancelled') as its own slice.
**⏭ CHAD SMOKE: delegate an agent-spawning task → while it runs, its Agent card shows ONE live
line naming the current tool (thread + Watch panel; no more growing list) → click Watch on the
card → full activity streams in the focused view → let it finish + RELOAD → the focused view
still shows the recorded activity + report (not "no report was captured"); the thread card stays
compact. Then commit (feat(chat) + docs).**

## (prev) NEXT ACTION (2026-07-19g): AGENT WATCH CHIPS + FOCUSED DRILL-DOWN — gate GREEN 503f/2645t, committed; NEXT: Chad's smoke

**Chad's parity ask (matches the recorded Phase-3 chips goal): Agent cards get a Watch chip
like task chips, in BOTH chats; clicking opens the side panel FOCUSED on that agent —
Back+Close when drilled in from the global trace, Close-only from a workspace thread card.**
- **session-viewer store grew the 2-level drill-down:** `openAgent(trace, toolUseId)` (direct,
  no Back) · `focusAgent(toolUseId)` (from the open trace, Back available) ·
  `clearAgentFocus()` · open/close reset focus. +4 tests.
- **ToolCallCard grew `watchable` + a Watch chip** (summary-row split — no nested buttons);
  ToolCallList threads `watchableAgents` (Agent/Task cards only) + `watchAgent` emit;
  ThreadStream forwards it for DELEGATION-traced messages (message.partialSessionId keys the
  trace channel, so the focused view attaches from anywhere); both views wire
  `sessionViewer.openAgent`. The PANEL's own list drills in via `focusAgent`.
- **SessionViewerPanel focused mode:** header = Agent <name> + live dot + the task description;
  Back arrow when agentBackAvailable; body = full-pane AgentActivityPane (live) → the final
  report (settled toolOutput) → honest empty states. Trace view untouched underneath.
- NOTE: chips appear on delegated rows only — a DIRECT turn's agent renders its inline nested
  pane in-thread (no trace channel exists for it; its focused view is the monitor arc's job).
**⏭ CHAD SMOKE: delegate an agent-spawning task → workspace thread's Agent card shows Watch →
opens the focused side view (Close only) · from global: Watch the task → click the Agent card's
Watch chip → focused view with BACK → Back returns to the trace.**

## (prev) NEXT ACTION (2026-07-19f): AGENT ACTIVITY IN THE WATCH PANEL — gate GREEN 503f/2639t, committed; Chad confirmed sync agents + trace live

**Chad's follow-up: the Watch panel (global view) should show a spawned agent's activity like
the chat thread does — his instinct matched the RECORDED old goal (ThreadStream: "chips return
for spawned sub-agents, Phase 3"; orchestration docs' "future monitor reconstructs the tree").
First slice shipped: the delegate's observer already forwarded agent-* events onto the trace
channel — only the panel's fold dropped them. `fold-trace-stream` grew the same `agentActivity`
fold the chat view has; `useDelegationTraceLive` exposes it; SessionViewerPanel passes it into
its ToolCallList → the SAME AgentActivityPane nests under the Agent card in the panel, live.
REMAINING Phase-3 vision (recorded, unbuilt): watch CHIPS for spawned agents in the global
thread + the full monitor tree over agent.run-started/completed outbox events.**

## (prev) NEXT ACTION (2026-07-19e): ORPHANED-APPROVAL WEDGE FIXED — gate GREEN 503f/2638t, committed; agent trace CONFIRMED WORKING by Chad

**Chad's stuck-cards report (approve → POST /approvals/:id/decide 404, cards wedged, agents
frozen): the pending approval ROWS survived a dev restart but the in-memory waiter registry
died with the process — `resolveApproval` let the provider's NotFound bubble as a 404 and left
the row pending FOREVER. The reaper already knew this lesson (its comment: post-restart id →
"proceed to the row update") — the interactive decide path never learned it. Classic
same-pattern sweep miss. Two fixes:**
- **`resolveApproval` is orphan-tolerant:** provider NotFound → warn + resolve the ROW anyway
  (nothing is parked — the park IS the waiter). Deciding a ghost card now clears it. +test.
- **Boot reap:** `recoverStalePendingApprovals` grew `reapAllPending` (at boot EVERY pending
  row is an orphan — the staleness window protects live parks, none exist at boot); server.ts
  calls it beside the ask boot-expiry. No more ghost cards for timeoutMs×2 after every
  `node --watch` restart. +test.
**Also this session: Chad CONFIRMED the agent-activity trace working live (3 parallel Explore
agents, nested activity, ask-mode subagent Bash carding). The earlier "Operation aborted"
screenshot = his own Stop mid-fanout (by design).**
**⏭ CHAD: restart mid-turn once → old cards vanish on boot; approve any lingering card → it
clears. Then the full smoke list from 19c/19d still stands.**

## (prev) NEXT ACTION (2026-07-19d): AGENT-ACTIVITY TRACE — gate GREEN 503f/2636t, reviewed APPROVE (2 hardening should-fixes folded); NEXT: Chad's smoke (spawn an agent, watch it nested)

**Chad's report: a workspace-spawned agent showed only "Agent · 15ms" while its tool calls
flooded the main thread unmarked and its text was invisible. Three root causes, one slice:**
- **`forwardSubagentText: true`** (SDK default forwards only subagent tool_use/result — text
  never left the CLI) + pin test.
- **Agents forced SYNCHRONOUS** via the PreToolUse backstop rewriting Agent/Task
  `run_in_background: false` (SDK 0.3.2xx backgrounds by default; Vynel's one-shot turn
  teardown killed them mid-run — the "15ms" was the async-launch ack). Rewrite COMPOSES with
  the approval floor (reviewer: never shadow a decision) + subagent `message_start` no longer
  poisons main-session id tracking (readers guard). ⚠ SMOKE ITEM: spawn under `auto` mode —
  exe strings hint `updatedInput` may satisfy a permission interaction in one branch.
- **Marked events, live-only rendering:** translator threads top-level `parent_tool_use_id` →
  optional `parentToolUseId` on text/thinking/tool events (+ SKIPS subagent usage — it was
  poised to overwrite the main session's occupancy) · consumer DIVERTS marked events into 3 new
  wire kinds (agent-text-chunk / agent-tool-started / agent-tool-completed), persisting NOTHING
  (the Agent card's settled toolOutput = the final report, real now that agents are sync) ·
  ActiveTurnView grew `agentActivity` keyed by the Agent call's toolUseId · NEW
  `AgentActivityPane` (@vynel/ui) nests under the card via ToolCallList's optional prop ·
  Agent/Task presenter ("Agent researcher · <description>", text body). Every other
  ChatTurnEvent consumer verified tolerant (no exhaustive switch anywhere).
- **Recorded (reviewer nits):** Watch panel drops agent-* by design (a routed turn's spawned
  agents show no nested trace THERE — module-notes note, future arc) · settled Agent card body
  could JSON-dump if the SDK returns block-array content (check on smoke) ·
  consume-session-event-stream at 369 lines (split next touch).
**⏭ CHAD SMOKE: any chat → ask for something an agent handles → the Agent card shows name +
task, activity nested live (tools + narrative), and the settled card carries the report after
reload · repeat under `auto` mode (the classifier-interaction question) · confirm no more
agent tool-calls rendered as the manager's own.**

## (prev) NEXT ACTION (2026-07-19c): CHAT-CONTROL ROUND (queue · stop · agents parity · modes · SDK bump) — gate GREEN 502f/2624t, reviewed (1 must-fix + 2 should-fixes folded), committed; NEXT: Chad's smoke

**Chad's 4 asks, all landed (3 recon subagents mapped the ground first — reports summarized here):**
- **① AUDIT: workspace turns DO load Claude content** — provider hard-codes
  `settingSources: ['user','project','local']` (build-claude-sdk-options.ts:86) + preset
  claude_code systemPrompt: CLAUDE.md/skills/agents/rules/settings all load like real Claude
  Code. Global root = user-level only (hidden empty cwd, by design). ⚠ INVARIANT: the agent
  disk-mirror's remove-on-disable is load-bearing BECAUSE settingSources loads `.claude/agents`
  — never narrow it casually. **SDK BUMPED 0.3.197 → 0.3.213** (all 9 consumers, ranges now
  ^0.3.213). Only breaks: canUseTool options gained REQUIRED `requestId` + CanUseTool result
  now nullable — test fixtures + fake-claude-query updated; no production change. ⚠ Behavioral
  risk is invisible (bundled CLI 2.1.x does the filesystem loading) — Chad's live smoke is the
  real validation.
- **② QUEUE + AGENTS PARITY** — ChatComposer no longer blocks mid-stream sends (send stays
  beside Stop); `useQueuedSend` (busy = view!==null, NOT isStreaming — the settle race; drains
  ONE per COMPLETED settle; interrupt/error PARKS the queue) + QueuedMessageChips in both
  views. Agents: workspaceId widened `string|null` down the resolve chain; global SSE stream +
  channel runner compose USER-scope agents + record agent.run-started/completed
  (payload workspaceId now nullable). Task tool availability: allowedTools is a skip-prompt
  list, not an availability gate — no allowlist change needed.
- **③ STOP** — `DelegationCancelRegistry` (session/delegation; tick begins/ends each claimed
  run keyed by partialSessionId, learns the RUNNING sdk session id via new
  delegate `onSessionResolved`) · delegate-to-workspace-root treats an external
  `session-interrupted` as a THROW (was: drained "clean" → green job + partial report — the
  recon's killer finding); breaker interrupt keeps its blocked-note return · tick fails a
  cancel-requested job 'stopped by the user' EVEN IF the turn completed (reviewer must-fix:
  Stop wins at terminal time; report suppressed) · `failPendingDelegationJob` CAS (pending-only
  guard) · routes: POST /root/delegations/:key/stop (pending→stopped, claimed→flag+interrupt,
  terminal→already-finished, 404 not-owned) + POST /root/turn/interrupt (primary's
  currentSdkSessionId → provider interrupt; the global Stop was CLIENT-ONLY before — server
  turn ran detached to completion) · UI: chip stop-square + viewer Stop button +
  use-chat-turn global interrupt. KNOWN LIMIT (recorded): a timed-out job's detached turn has
  no stop lever (registry entry ends at tick terminal); pre-existing doctrine.
- **④ MODES: VERIFIED WORKING end-to-end** (recon: every hop intact; table in the journal).
  Root cause of "modes don't work": composerMode was NEVER persisted — reset to 'ask' every
  reload. ui-store now persists mode+model (fail-closed against the catalogs) + the
  workspace-route mode→permissionMode pin test (was global-only). Background turns stay
  deliberately bypass (channel/schedule/subagent) — the floor still cards.
**⏭ CHAD SMOKE: send 2-3 messages while Claude replies → chips queue + fire in order · delegate
a task → stop it from the chip AND from the watch panel (job reads "stopped by the user", no
report lands) · Stop in the global chat mid-reply → reply actually halts (check Telegram isn't
still typing) · set bypass, restart the app → still bypass · in the GLOBAL chat ask for
something an installed user agent handles → it spawns · confirm a workspace chat still picks up
the workspace's CLAUDE.md/skills after the SDK bump (the invisible-risk check).**

## ⏭ NEXT ACTION (2026-07-19b): LIVE-TURN LAYOUT PARITY + DYNAMIC TASK CHIPS — gate GREEN 500f/2605t, reviewed CLEAN (2 should-fixes folded), committed; Chad CONFIRMED the realtime fix live

**Round 2 (same session, Chad's follow-ups): ① the live turn rendered ONE flat block (all text,
then all tool cards) that silently reformatted into per-message blocks on reload ② the Watch
chips said canned "Watch <persona>" / "Working in <ws>…" instead of naming the task.**
- **① ActiveTurnView is now SEGMENTED by assistant message** (`segments[]`, arrival order; tool
  calls attach by parentMessageId; flat text/toolCalls/assistantMessageIds fields REMOVED —
  segments are the one truth, the ThreadStream dedupe derives from them). LiveTurn renders one
  thinking→text→tools block per segment (the settled MessageRow shape — nothing reflows on
  settle); cursor/shimmer only on the last segment. Only 6 files ever consumed the view (fold,
  LiveTurn, ThreadStream, 2 pass-throughs, tests) — verified no dangling flat-field consumer.
- **② `deriveDelegationTaskLabel`** (contracts, one home: first line, collapsed, ≤120) →
  in-flight DTO grew `taskLabel` (orchestration + route schema + SDK) → banner chips say
  "<workspace> · <task>" · **`attachDelegationTaskLabels`** (session/delegation — the
  composition tier) enriches root.getSession report rows with `delegationTaskLabel` (optional
  in ChatMessageSchema — unenriched routes stay type-safe) → Watch chip says
  "<workspace> · <task>" (persona dropped — the author line already names it; fallbacks intact
  for pruned jobs). `workspaceNameFromLabel` exported from workspace-color (one home for the
  persona-first LAST-segment parse); the inverted "Marketing site · Mara" test fixture FLIPPED
  (the old trap). Both chips ellipsize at 420px.
**⏭ CHAD SMOKE: delegate a task from global chat → banner chip "<ws> · <task>" → Watch opens
trace; after the report lands, its chip names the task too; ask a tool-using question → the
live answer's tool cards sit INSIDE the reply exactly as after a reload.**

## (prev) NEXT ACTION (2026-07-19): REALTIME CHAT FIXED (the session-activity feed) — gate GREEN 498f/2597t, reviewed (1 must-fix folded), committed; Chad's smoke CONFIRMED FIXED

**Chad's 3 symptoms, root-caused: ① Telegram replies never surfaced without reload (NO server→UI
push existed anywhere — channel turns run `runGlobalRootTurn` invisibly; the 4s thread poll only
armed while a DELEGATION was in flight) ② duplicated tab = stale + dead (same gap) ③ "response
starts again" = ThreadStream rendered persisted rows + the live overlay with NO dedupe while rows
persist per text-chunk (any mid-turn refetch doubled the reply). Also named: the per-user root-turn
lock makes a web turn silently queue behind an invisible Telegram turn — now visible, not silent.**

**THE FIX — one mechanism, `GET /activity/stream` (per-user SSE session-activity feed):**
- **Contract** `contracts/chat/session-activity.ts` — turn-started/updated/ended, origin
  web|voice|telegram|discord|schedule. **`TurnEventBroadcaster` genericized** (type-only).
- **`SessionActivityFeed`** (`@vynel/session/runtime`) — stateful registry + fan-out; subscribe
  REPLAYS the in-flight snapshot (a tab opened mid-turn learns immediately). One per process
  (AppEnv `activityFeed`; server.ts shares it with channels + schedules services).
- **ALL FOUR producers announce begin/sessionResolved/end:** streamChatTurn (workspace web),
  streamGlobalRootTurn (global web/voice), runGlobalRootTurn (channel background; deps grew
  REQUIRED activityFeed), buildScheduleFireDeps (wraps injected startChatTurn generator —
  schedule fires announce too). ⚠ begin() sits IMMEDIATELY before each try/finally — the
  reviewer's must-fix: anything throwable between begin and finally leaks a process-lifetime
  zombie turn (feed replays it forever). Route `routes/activity/` + SDK regen (`activity` ns
  pinned in namespaced.test).
- **Web:** activity-store grew the server-turn map (presence dot now lights for background
  turns); `composables/activity/` feed reader (heartbeat-skip decode over the extracted shared
  `readSseFrames`) + `useSessionActivityFeed` (ONE subscription in AppShell; reconnect w/
  backoff; resets map on drop; settle-invalidates sessionKeys.all at turn boundaries +
  workspaces on end). GlobalChatView/WorkspaceView poll their thread 4s while a background turn
  runs in-scope (NEVER during their own stream) + "Replying on Telegram…" banner chip.
- **The dedupe fix:** ActiveTurnView grew `assistantMessageIds` (EVERY assistant message the
  turn touched incl. tool parents); ThreadStream filters those + the turn's user message out of
  persisted history while the overlay renders — kills the double-response glitch (incl. the
  settle-refetch flash after every own turn).
- **Sweeps:** root test harness gained askWaiters (pre-existing swallowed TypeError in every
  streamed root test) + activityFeed. Deferred nits (recorded): backoff sleep not abortable
  (≤15s lingering closure post-dispose, benign) · ms-scale "Working…" flash after own global
  turn · delegation turns deliberately NOT on the feed (in-flight poll already covers them
  symmetrically).
**⏭ CHAD SMOKE: app open on global chat → message the Telegram bot → user msg + reply grow into
the thread live (+ banner chip + presence dot) · duplicate the tab mid-answer → both live ·
web turn while Telegram turn runs → banner explains the wait. Then the SSH big smoke below.**

## (prev) NEXT ACTION (2026-07-17e): SSH MODULE BUILT (arc ④ — THE ARC IS COMPLETE) — gate GREEN 492f/2573t, security reviewer running; then commit + Chad's big smoke

**④ SSH BUILT (docs/module-notes/ssh.md; Chad's forks: master key in the OS KEYRING; NO cards on
run_ssh_command — like Apps, vision tension RECORDED with mitigations):**
- **Leaf `packages/ssh-servers`** — ssh_servers (migration `0009_ssh_servers`; nullable
  workspaceId=global) · `encryptedCredentials` = AES-256-GCM sealed blob (per-secret nonce; key
  32B from the keyring vault, quarantined `./keyring` subpath; NO read-credential surface —
  rotation = remove+re-add) · connect-per-command ssh2 exec (60s timeout, output caps, TOFU
  hostVerifier → SshHostKeyMismatchError pre-auth) · runServerCommand opens the secret ONLY
  inside the exec path; outbox ssh.command-executed carries the plain-language description,
  NEVER the raw command or secret · `vynel-ssh` descriptor factory (list_ssh_servers +
  run_ssh_command w/ REQUIRED description; mutatingToolNames [] per Chad) attached to the two
  interactive streams only-when-key-exists (typeof guard fails closed). Leaf+route tests run a
  REAL loopback ssh2 Server (password dana/sourdough) — handshake, TOFU pin+bite, no-secret
  assertions everywhere.
- **Wiring (subagent)** — routes /ssh-servers (list/add/delete/test-connection; featureGate('ssh')
  pro key; no-master-key → 409 ConflictError, documented deviation — taxonomy has no 5xx) ·
  server.ts resolves the master key from the keyring at boot · CLI `vynel ssh list|test|remove`
  (NO add — secrets never on CLI flags) · **verified book `working-with-servers.md`** (3rd book;
  shelf pins updated).
- **UI (subagent, 230 local-web tests)** — SshServersSection both scopes + LockedFeatureCard('ssh'),
  arm-then-confirm remove, Test button (✓ / plain failure / DISTINCT 409 identity-changed
  warning), AddServerDialog (password|private-key tabs, "encrypted and never shown again — not
  even to Claude", credential cleared from refs on success).
- pnpm-workspace.yaml allowBuilds += ssh2/cpu-features (placeholders pnpm scaffolded — set true).
**⏭ NEXT: fold security-review findings → commit+push (feat(ssh) + docs) → CHAD'S BIG 4-ARC
SMOKE (migrations 0006-0009 apply on boot): tasks in a workspace chat · an ask wizard + its
Telegram nudge · "run my app" end-to-end · add a real server, "check disk space on my server" →
watch the Servers history line appear. THE TASKS→ASK→APPS→SSH ARC IS THEN DONE.**

## (prev) NEXT ACTION (2026-07-17d): APPS MODULE BUILT (arc ③) — SHIPPED `d0c78f0`+`9584d8e`, pushed; reviewer 1 must-fix (spawn-failure ghost) FOLDED pre-commit

**③ APPS BUILT (docs/module-notes/apps.md; Chad: NO cards anywhere, Claude adds/runs freely,
live ring-buffer logs only, pro tier):**
- **Leaf `packages/apps`** — `workspace_apps` (migration `0008_workspace_apps`; WORKSPACE-scoped
  NOT-NULL workspaceId — deliberate narrowing, an app needs a cwd) · case-insensitive per-
  workspace name uniqueness · register/update/remove ops (outbox app.registered/updated/removed)
  + runtime facts app.started/stopped/crashed (own-tx, the relay delivers them someday) ·
  **AppProcessSupervisor** (spawn shell:true; `resolveContainedCwd` refuses workspace escapes;
  2000-line ring buffer; win32 `taskkill /T /F` tree-kill vs SIGTERM→SIGKILL-3s; crash-vs-
  requested-stop; onExit→publishAppExitOutcome; stopAll on shutdown — no orphaned dev servers).
  Leaf tests spawn REAL `node -e` processes.
- **Routes** `/workspaces/:id/apps` behind `featureGate('apps')` (entitlements grew the `apps`
  pro key): list(+live runtime merged)/add/update/delete(user-only, stops first)/start/stop/
  logs. 6 x-mcp tools ALL uncarded (list_apps/add_app/update_app/start_app/stop_app/
  get_app_logs; add_app teaches derive-the-command-by-inspecting; start_app teaches
  check-logs-after). Supervisor DI'd (createApp option; server.ts constructs w/ onExit).
  Route tests drive REAL processes end-to-end incl. cross-workspace-URL 404 binding.
- **UI (subagent, 215 local-web tests)** — AppsSection+AppRow+AppFormDialog (status dots,
  Start/Stop pill, open-in-browser, 2s log tail auto-scroll, LockedFeatureCard('apps'),
  workspace-only registration). **CLI** `vynel apps list|add|start|stop|logs|remove`.
**⏭ NEXT: fold reviewer findings → commit+push → Chad smoke (in a workspace with a runnable
project: "run my app" → Claude list_apps→add_app→start_app→logs; Apps section dots/logs/
browser-link; stop from UI; quit Vynel → nothing orphaned; basic-tier account sees the Pro
lock) → arc ④ SSH (module notes first: DB-encrypted creds + key-location design, ssh2 exec
tool, verified notebook book, plain-language cards — the deferred approval-granularity call).**

## (prev) NEXT ACTION (2026-07-17c): OUTBOX RELAY WIRED (the ask-nudge slice) — SHIPPED `0e1174d`+`6585125`+`7829401`, pushed; reviewed CLEAN

**The generic outbox relay is LIVE (was wired nowhere since it landed):** `OUTBOX_CONSUMERS`
now carries 'schedule.run-completed' → the (formerly dormant) channels delivery consumer and
'ask.created' → the NEW ask-nudge consumer (`packages/channels/src/delivery/
consume-ask-created-event.ts`; channel fallback ask-workspace → global → any-enabled → drop;
payloadKind 'ask-nudge'; body "🙋 Claude needs your input: <label> (+N more) — open Vynel").
`services/outbox-relay-service.ts` drives dispatch every 5s. **Flood guard:**
`skipStaleOutboxEvents` at service boot marks >10-min-old registered events processed
UNDELIVERED (months of pre-relay backlog on live dev DBs must not spray stale Telegram
messages) — and `ask.created` skips REGARDLESS of age at boot (boot recovery just expired every
pending ask, so a post-boot nudge always points at nothing). Core gained @vynel/channels (spine
composes leaves — sanctioned). Reviewer: CLEAN 0-must-fix; 3 nits folded (Claude-vs-Vynel
naming reconciled to "Claude", ask.created zero-cutoff, fallback-priority test).

**APPS DECISIONS (Chad, 2026-07-17): Claude manages apps freely — new workspace, needs to run
an app → adds it and runs it, NO permission/card (users can also start from UI) · logs = live
in-memory ring buffer only (~2000 lines, nothing on disk) · discovery = Claude adds what it
needs when it needs it (no background scanner).** Apps is PRO-tier (featureGate + entitlement
key). Workspace-scoped v1 (an app needs a cwd; global has no path). Next: write
`docs/module-notes/apps.md` → leaf `packages/apps` (workspace_apps table, migration 0008) +
process supervisor (node:child_process, ring buffer, Windows-aware kill) + routes/tools
(list_apps/add_app/start_app/stop_app/get_app_logs, all uncarded) + AppsSection UI + CLI.

## (prev) NEXT ACTION (2026-07-17b): ASK MODULE BUILT (arc ②) — SHIPPED `35e5759`+`2c693b1`, pushed; reviewed CLEAN (turnKey fix folded)

**② ASK BUILT (docs/module-notes/ask.md = as-built; fork answers: NO auto-timeout — an ask
WAITS, dismiss is the only proceed-without-me; interactive app turns ONLY; notifier + Modal
wizard):**
- **Contracts** `contracts/src/asks/` — question/answer zod schemas + PURE validateAskAnswers
  (type-aware: required/optional, off-menu + unknown-key rejection), AskRequestResponse.
- **Leaf `packages/asks`** — ask_requests (migration `0007_ask_requests`), repos, create/resolve/
  expire ops (outbox ask.created [firstQuestionLabel+count for the future nudge] / ask.resolved;
  answers NEVER in payloads), **PendingAskRegistry** (in-memory waiter map; cancelForScope) +
  **ask_user tool** (parks on the registry, NO timeout) + descriptor FACTORY on the SDK-free-
  barrel-split `@vynel/asks/mcp` subpath.
- **local-api** — /asks routes (pending/answer/dismiss; DB-commits-BEFORE-waiter-resolve; failed
  answer consumes NEITHER the ask nor the waiter), askWaiters DI (createApp option + c.var),
  descriptor attached to the TWO interactive streams only (chat-turn + global-root-turn), turn-end
  cancelForScope+expire in both finallys, boot expiry beside the approvals reaper.
- **⚠ PRE-EXISTING BUG FOUND+FIXED+SWEPT: workspace turns DROPPED composedMcp.systemPromptAppend**
  (notebook's standing line + the new tasks/ask lines never reached workspace chats or fired
  schedules; only the global stream passed it). Both sites now join capability+MCP prompts;
  FireScheduleDeps grew systemPromptAppend (stub + fire-schedule test updated).
- **UI (subagent)** — AskNotifier toast (beside ApprovalNotifier, collision-shift) +
  AskWizardDialog (Modal; one-question-per-step, progress dots, Next-gated, "View as form"
  switch, only-answered-keys submit, inline 400 surfacing, "I'll decide later") + composables
  (5s poll like approvals). 202 local-web tests.
- **DEFERRED (next-slice candidate): the Telegram nudge — the generic outbox relay
  (dispatchOutboxEvents + OUTBOX_CONSUMERS) is WIRED NOWHERE (registry empty, no service drives
  it; the schedules→channels delivery consumer is dormant too). Wiring it activates dormant
  machinery → its own reviewed slice. ask.created already carries what the nudge needs.**
**⏭ NEXT: fold reviewer findings → commit + push (standing auth, NO AI trailer) → Chad smoke
(in a chat ask Claude something that needs your input → notifier card → wizard → answers reach
Claude; dismiss → Claude proceeds; interrupt a turn mid-ask → wizard vanishes) → arc ③ APPS
(docs/module-notes/apps.md first; remember the outbox-relay slice decision).**

## (prev) NEXT ACTION (2026-07-17): TASKS MODULE BUILT + REVIEWED CLEAN (arc ① of Tasks → Ask → Apps → SSH) — SHIPPED `9a4ac69`+`b2a3cfb`, pushed

**Reviewer: CLEAN, 0 must-fix. 2 should-fixes APPLIED (stray `_tmp_*` root files deleted; the
real vynel descriptor's tasks gate list + capability-aware contributePrompt now pinned by tests)
+ badge 9+ cap nit applied. Deferred nits (recorded, non-blocking): Home Tasks card open-list
uncapped (house-consistent w/ upcomingSchedules — cap + "view all" when lists grow) ·
dashboard completed-tail derives from the newest-100-by-createdAt window (fine at personal
scale) · schedulesUser/tasksUser create don't pre-verify a workspace-scope workspaceId (FK →
500 not 400; pre-existing schedules pattern, codebase-wide sweep candidate).**

**Chad's 4-feature arc (2026-07-17, memory [[tasks-apps-ssh-feature-arc]]): ① Tasks ② Ask (form-
wizard user input via a blocking `ask_user` tool — one question per step + "view as full form"
switch) ③ Apps (register/run/monitor workspace apps; net-new process-runner) ④ SSH servers
(DB-ENCRYPTED creds + a library so Claude drives ssh blind; verified notebook BOOK teaching
Claude server work; approval-card granularity still open). Tiers: Tasks FREE; Apps+SSH pro.
Order Chad-approved. Design per module: `docs/module-notes/<module>.md` BEFORE building.**

**① TASKS BUILT (this session, `docs/module-notes/tasks.md` = as-built):**
- **Leaf `packages/tasks`**: `tasks` table (migration `0006_tasks`; userId + nullable workspaceId
  NULL=global; status open|in-progress|done; source assistant|user; sessionId LOOSE ref;
  completedAt) · functional repos · create/update/delete ops, outbox co-commits
  (task.created/updated/completed/deleted; →done emits task.completed + stamps completedAt,
  leaving done clears it, already-done→done keeps the original stamp).
- **Routes = the TWO-DOOR provenance model**: workspace-scoped `/workspaces/:id/tasks` is the
  AGENT's door (source='assistant' HARD-CODED, x-mcp tools list_tasks/create_task/update_task/
  complete_task, mutatingApproved = UNCARDED like memory writes, NO delete tool); user-scoped
  `/tasks` is the USER's door (source='user', panel/CLI, owns DELETE, x-mcp list_my_tasks only).
  Unspoofable by construction. NOT featureGated (free tier).
- **Capability `tasks`** (defaultEnabled) gates all 5 tools on vynelWorkspaceDescriptor.
  **CONTRACT CHANGE (additive): `contributePrompt` gained optional 2nd param
  `enabledCapabilityIds`** — the multi-capability vynel descriptor drops ONE capability's prompt
  section (TASKS_PROMPT_INSTRUCTIONS) while others' tools stay live; composer passes it + spec
  test. Global root: NO task tools v1 (router; global rows come via tasksUser).
- **Dashboard** getOverview += openTasks + recentlyCompletedTasks(≤5, by completion time).
- **UI (subagent-built, reviewed green)**: TasksSection+TaskRow+TaskStatusControl (Channels
  beauty template, inline composer, collapsed Done group) on BOTH surfaces · TasksPanel right
  dock (SessionsPanel pattern; ui-store isTasksPanelOpen; AppTitleBar ListChecks icon + count
  badge + View-menu toggle + `toggle-tasks` command) · HomeView span-2 Tasks card ·
  composables/tasks/* (shared invalidateTaskViews → tasks list + dashboard overview).
- **CLI**: `vynel tasks list|add|done|reopen|delete` over tasksUser (user door only).
- **Spec growth folded**: api-tools + namespaced spec tests, capability leaf/route tests.
- **⚠ ENVIRONMENT (this box): WSL-side pnpm is BROKEN on the drvfs mount (EPERM futime) — run
  ALL pnpm/vitest through Windows: `cmd.exe /c "pnpm test"` from the repo root.** sed -i leaves
  zero-byte `sedXXXXXX`/`_tmp_*` files at root — clean them before committing.
**⏭ NEXT: fold reviewer findings → commit (feat(tasks) + docs; standing commit authorization,
NO AI trailer) + CHANGELOG → Chad smoke (ask for multi-step work in a workspace chat → tasks
appear as tool cards + in the panel/badge/dashboard; toggle Tasks capability off → tools + prompt
vanish) → write `docs/module-notes/ask.md` and start arc ② ASK.**

## (prev) NEXT ACTION (2026-07-14c): SECTION BEAUTIFY + PRIMITIVE UNIFICATION — ✅ DONE (gate GREEN 457f/2417t, reviewed, pushed, machine shut down)

**✅ COMPLETED autonomously (Chad away):** all 8 feature sections Tailwind-migrated THEN beautified
to the Channels card template (rounded-lg cards, tinted icon tiles, hover-reveal actions, elevated
SectionHeader); ALL 7 dialogs moved onto the `Modal` primitive (+ MemoryTagsField/FilePickerField);
canvas padding 44/40. Reviewer: 1 must-fix + 1 should-fix APPLIED (marketplace chip `<p>` margin;
`Modal` now honors `autofocus` via `@open-auto-focus`). Commits `7d0ab22 2348d0f 2608385 6118685
e510db2 7ed8fcf 2713091` (+docs). Gate GREEN 457f/2417t at each step; verified sections + dialogs in
Playwright (dark+light). **DELIBERATELY DEFERRED (not done, with reasons):**
① **ConfirmButton adoption** — the arm-then-confirm confirms (Marketplace remove, Channels/Notebook
  icon disconnect/delete, Account Keep/Confirm pair) were NOT moved onto the `ConfirmButton`
  primitive: its fixed styling (rounded-sm/text-sm/bordered, always-label) doesn't fit the inline
  pill/icon/pair contexts without a look regression + risky logic/test rewrites blind. They already
  share ONE consistent arm-then-confirm pattern. To adopt later: give `ConfirmButton` a size/variant
  (+ icon-only) prop, then swap + rewrite those tests.
② **ReadBookDialog width** shrank 640→512px (`Modal` maxes at `size="lg"`); add a `size="xl"` to Modal.
③ **CreateScheduleDialog** is 364 lines (>300 house rule); extract a `ScheduleCadenceFields.vue`.
④ From before: unified right dock (History/Files/Trace tabs) — views still render their own panels.
**Chad smoke when back:** open each section + each dialog; confirm autofocus lands in the first field.

**⚠ (prev) AUTONOMOUS MANDATE (Chad, 2026-07-14, then unavailable): finish ALL of the below, keep the gate
green, COMMIT + PUSH, then SHUT THE MACHINE DOWN with `shutdown /s`.** Guardrail: if the gate is red
or the push fails, DO NOT shut down — leave it on + the work committed locally. Chad chose "unify all
now, then shut down." Commits go straight to `main` + push (trunk-based); NO AI-identity trailer
([[no-ai-identity-in-commits]]).

**GOAL:** every section + dialog on ONE beautiful pattern built from the @vynel/ui primitives — not
just a Tailwind port (Chad: "all our UIs need to be in same pattern" as the /ui-preview demo).

**DONE + committed (local; origin/main is at `b31a26b`, LOCAL IS AHEAD ~3 UNPUSHED — push at the end):**
- `7d0ab22` marketplace section → Tailwind (the port template) + SectionHeader + canvas padding 44/40.
- `2348d0f` remaining sections → Tailwind (behavior-neutral port; Channels/Schedules/Knowledge/Memory/
  Notebook/Agents/Account + AccountDeviceRow/AccountSignInForm + LockedFeatureCard). Gate 457f/2417t.
- `2608385` **beauty template**: SectionHeader elevated (icon tile + bigger title — all sections inherit)
  + Channels beautified. THIS IS THE VISUAL REFERENCE Chad approved.

**REMAINING (do these, verify each, then commit+push+shutdown):**
1. **Beautify 6 sections** to the Channels template: Schedules, Knowledge, Memory, Notebook, Agents,
   Account(+AccountDeviceRow/AccountSignInForm). Recipe: items→`rounded-lg border border-hair bg-raised
   p-3` cards, `gap-2`, `hover:border-hair-strong hover:shadow-raised`; icon tiles `size-9 rounded-md`
   soft-tinted (`bg-info/10 text-info`, memory violet `bg-ws-3/10`, etc.); title `text-sm font-semibold`
   + sub `text-xs text-ink-3`; hover-reveal secondary actions (`opacity-0 group-hover:opacity-100
   focus-visible:opacity-100`); GOLD = PRESENCE ONLY; preflight deferred so every `<p>` needs `m-0`.
   Ref: `components/sections/ChannelsSection.vue` + `SectionHeader.vue`.
2. **Dialogs → `Modal` primitive** (7): ConnectChannelDialog, AddKnowledgeDialog, AddMemoryDialog,
   CreateScheduleDialog, ReadBookDialog, WriteBookDialog, CreateWorkspaceDialog. Replace each hand-rolled
   `<Teleport>`+backdrop with `<Modal v-model:open :title :description>` (body=default slot, actions=
   `#footer` slot). Behavior-changing → UPDATE each dialog's colocated test to the new structure.
3. **Confirm idiom → `ConfirmButton` primitive** (4): Channels disconnect, MarketplaceItemCard remove,
   AccountDeviceRow revoke, NotebookSection delete. `<ConfirmButton label confirmLabel danger @confirm>`.
   ⚠ This CHANGES the aria-labels/text tests assert (e.g. marketplace "Confirm remove X") → UPDATE those
   tests to ConfirmButton's output (`aria-pressed` + label/confirmLabel). Deliberate spec change.

**HOW TO VERIFY (critical):** the Claude-Browser `computer` screenshot HANGS (30s timeout) — use the
**`playwright-cli`** skill instead (global cmd). Dev server = Chad's, http://localhost:8999 (`pnpm dev`;
local-web + local-api). Reach a section: open /chat → click the sidebar section button. Real data:
workspaces vynel+letterman, channel "Theris", marketplace Email Drafter+Focus Writer, account kafi Pro
+ KLONE device. Screenshot dark AND light (`document.documentElement.dataset.theme='light'`). Gate =
`pnpm test` (turbo typecheck + parity + vitest); currently GREEN 457f/2417t. Run code-reviewer on the
diff before the final commit. Primitives live in `packages/ui/src/components/` (Modal, ConfirmButton,
DropdownMenu, ContextMenu, Tooltip, CommandPalette, ResizablePanel); demo at `/ui-preview`.

**FINISH LINE:** all 3 items done → full gate GREEN → commit (feat/refactor, no AI trailer) → `git push
origin main` → confirm pushed → `shutdown /s /t 30`. (Only if green + pushed.)

## (prev) NEXT ACTION (2026-07-14b): DESKTOP SHELL ADOPTED IN THE REAL APP (Wave B) — gate GREEN 457f/2417t, committed + PUSHED; NEXT: unified right dock (History/Files/Trace tabs) + Chad's live smoke

**Wave B shipped (done autonomously per Chad; verified in-browser + gate-green, no live smoke yet).**
App.vue is now thin (bare-route / onboarding / `<AppShell>`); the reinvented shell lives in
`components/shell/AppShell.vue` — `AppTitleBar` (menu bar Vynel/Assistant/View/Go + workspace switcher
[Global + workspaces + New] + Tauri-aware window controls via the `__TAURI__` global + presence),
resizable `AppSidebar` (Home/Chat segmented toggle + contextual sections + account row), the routed
view as canvas, `AppStatusBar`, ⌘K `CommandPalette`, plus the existing overlays. **Nav model (Chad):
no Workspace tab — Home/Chat toggle + the title-bar switcher enters a room; sidebar owns the feature
sections (drove ui-store `mainView`).** The two chat views only lost their `MenuPanel` (all chat/
session logic untouched); HomeView untouched. **Deleted (orphaned):** `TitleBar.vue`, `MenuPanel.vue`,
`WorkspaceSwitcher.vue` + ui-store `isMenuOpen`. Reviewer: 0 must-fix; 3 should-fixes APPLIED (①
Settings/Application no longer misroutes to the chat thread inside a workspace — non-workspace sections
route to global; ② dead menu items removed, Quit wired to `controls.close()`; ③ shell + its data hooks
[incl. the 5s approvals poll] lifted into `AppShell` so the `/jarvis` bare overlay doesn't run them).
New tests: AppSidebar/AppStatusBar/AppTitleBar/use-window-controls; app-shell.test updated to the 2-tab
model. **LIVE-VERIFIED in-browser (real API, tab reload): Home/Chat/sections/workspace-switcher [real
workspaces vynel+letterman]/⌘K all work, theme+light-mode clean, console clean, Application-in-workspace
fix confirmed.** ⚠ Screenshots hung (browser-pane glitch) — verified via computed styles + JS + get_page_text.
**⏭ DEFERRED (documented): the unified tabbed right dock (History/Files/Trace) — the views still render
their own SessionsPanel/FilesPanel; Trace stays the floating SessionViewerPanel. Also: quick-access
voice/theme icons dropped from the title bar (now in menus + ⌘K) — re-add if Chad wants. `/shell-preview`
+ `/ui-preview` dev galleries kept. CHAD SMOKE: run the app, drive the shell, then decide on the dock.**

## (prev) NEXT ACTION (2026-07-14): DESKTOP-SHELL REINVENTION — PHASE 3A (Tailwind bridge + primitives) BUILT + GATE-GREEN (453f/2403t), COMMITTED (`12eeea9`+`4b50ce1`); Wave B = the new shell wired to existing views

**Chad reopened two LOCKED UI calls (memory [[desktop-shell-reinvention-tailwind]]): full Tailwind
migration + reinvent the 3-tab shell into a real desktop app (title bar · menu bar · resizable panes ·
command palette · context menus · tooltips), window target = simulate + Tauri-aware.** Docs:
`docs/desktop-shell-inventory.md` (Phase 1 map) · `docs/desktop-shell-design-spec.md` (Phase 2 spec).
**Phase 3A built (Chad chose "token bridge + primitives first, then the shell"):**
- **Tailwind v4 bridge** (`@tailwindcss/vite` in local-web; `@theme inline` in `app.css` maps
  `tokens.css` → utilities; preflight deliberately OFF for now so nothing regresses; keyframes +
  reduced-motion + overscroll-none added). VERIFIED live in browser: `bg-gold`→#d9a03f, `bg-panel`
  flips #14171c↔#f7f8fa on `[data-theme]` toggle. Utilities are theme-reactive.
- **Reka UI** (`reka-ui` in `@vynel/ui`) as the headless behavior layer. **7 primitives** built +
  exported + tested (80 ui tests): `Tooltip · DropdownMenu · ContextMenu · Modal · CommandPalette
  (⌘K, hand-rolled combobox in a Reka Dialog) · ResizablePanel (hand-rolled, persisted, the
  signature) · ConfirmButton`. Shared `menu-shared.ts` (item model + token classes). vitest.setup.ts
  polyfills (ResizeObserver/matchMedia/pointer-capture) for Reka in happy-dom.
- **Preview gallery:** bare route `/ui-preview` (`views/PrimitivesPreview.vue`) — living component
  gallery + bridge proof. ⚠ Screenshots hung (browser-pane issue); verified via computed-styles + JS.
  **⏭ CHAD SMOKE: open http://localhost:8999/ui-preview — menu bar dropdowns, ⌘K palette, drag the
  panel dividers (widths persist on reload), right-click the dashed box, toggle theme.**
**⏭ COMMIT (prompt out; suggest `feat(ui): tailwind token bridge + reka-ui desktop primitives` +
`docs`): existing scoped-CSS components UNTOUCHED (incremental). Then Wave B: build the shell
(title+menu bar, left nav, split panes, right dock, status bar) and wire the existing views into it,
per the design spec.** OPEN from before: instructions arc · mcp/plugin forks · Chad's marketplace smokes.

## (prev) NEXT ACTION (2026-07-12g): MARKETPLACE POLISH ARC SHIPPED (storefront · scopes+global surface · portal user-mgmt · agents shelf · DISK MIRROR) — gate 2384/4-skip, all committed; OPEN: instructions arc · mcp/plugin forks · Chad's smokes

**Since 12f, five commits (all reviewed, 0 unresolved must-fix):** `e525275` storefront cards+search+
kind filters (panel slimmed 465→237) · `5c071af` item scopes user|workspace|both + the GLOBAL
marketplace surface (user-scope installs; workspace-install surface gate was the round's must-fix —
no orphanable rows; legacy null scope → 'both'; Chad's live rows flipped to 'both' via admin API) ·
`f9799be` portal USER MANAGEMENT (accounts table role/tier/status; disable revokes sessions, shared
op with the user.removed webhook; 'Add Marketplace Catalog' rename) · `738a248` agents SHELF both
surfaces (root cause: the panel was a stub + GET /agents required workspaceId + no invalidations —
installs had worked and reached sessions all along) · `53efe66` **agent DISK MIRROR** (Chad:
installed things must be visible files): `.claude/agents/<slug>.md` per scope, lifecycle-synced
(present ⇔ installed AND enabled — SDK loads filesystem agents but programmatic wins collisions,
so remove-on-disable is load-bearing), marker-guarded BOTH ways (write clobber-guard ConflictError
+ delete marker check), hostile-name frontmatter injection neutralized (TWO independent reviews
each caught a distinct must-fix). Vitest testTimeout 20s all three projects (argon2/parallel-load
flake class killed). **Chad expectation RECORDED (module notes): every installable kind lands as a
visible file — rule/mcp arcs inherit it.** ⏭ Chad smokes with dev stack UP: global Marketplace ·
Agents shelf · toggle focus-writer Off→On → mirror file appears · portal Accounts page.

## (prev) NEXT ACTION (2026-07-12f): REMOVAL FLOWS + CHANNELS EVENTS SHIPPED — gate 2303/4-skip; Chad testing everything; OPEN: instructions arc · mcp/plugin forks · channel sender-allowlist events (flagged, unevented) · hub-served portal

**Chad's removal ask, built + reviewed (0 must-fix):** channel row remove (backend pre-existed —
op+route+cascades D16; UI two-step added + cascade test) · `POST /workspaces/:id/marketplace/
uninstall` (per-kind dispatch skill→uninstallSkill / agent→softDeleteAgent via the annotator's own
readers; card flips to Get; SDK +uninstall) · **slug-collision drift CLOSED** (annotator matches
source==='community' only — a hand-made agent can never be uninstalled by the marketplace; e2e
test) · **channels leaf outbox pass** (channel.connected/disconnected/enabled-changed co-committed;
disconnects+toggles gained their missing txs; token-never-in-payload asserted; sender-allowlist ops
flagged as the remaining unevented pair) · **vitest node testTimeout 20s** (root-cause fix for the
recurring argon2/PGlite parallel-load flake — 3× today, always green isolated).

## (prev) NEXT ACTION (2026-07-12e): ARC ④ NOTEBOOK v1 BUILT (books, not memory) — backend COMMITTED `809a173`, routes+UI slice reviewed CLEAN + nits folding; commit next; OPEN: instructions arc (deferred by Chad) · mcp/plugin kind forks · Chad's live smokes

**⚠ CONCEPT (Chad, memory [[notebook-is-books-not-memory]]): notebooks are BOOKS — on-demand curated
reference Claude reads via list/read tools ('research with latest data'); NEVER prompt-injected; the
always-instructions arc is DEFERRED ('implement all in instructions later'; schema reserves
mode='always').** Built across two slices + two review rounds (both 0-must-fix):
- **`809a173` backend:** `packages/instructions` leaf (instruction_documents, migration 0005
INCREMENTAL — dev DBs apply on boot, NO reset; workspaceId = kernel FK cascade after reviewer
catch) · `notebooks/` verified-books dir (frontmatter loader, README, 2 starters: web-app-scaffold ·
communicating-with-users) · read-only `vynel-notebook` descriptor (list_playbooks/read_playbook,
verified WINS collisions, capability 'notebook' defaultEnabled) attached at ALL FOUR turn points ·
`defaultEnabledCapabilityIds()` for global-root turns · **composer now skips contributePrompt when
every gated tool is denied** (first gated+prompt descriptor — divergence-class fix) ·
fetch-context-report attachment drift fixed · outbox events throughout.
- **Routes+UI slice (committing now):** /notebook route family (merged shelf reads; user-doc CRUD
with ownership gates IN THE OPS, not-found/not-owned identical 404s; verified ids untouchable by
construction — UUID row ids can't collide with kebab verified ids) · SDK +notebook namespace ·
NotebookSection (verified badge read-only · WriteBookDialog · ReadBookDialog via sanitized
MarkdownText) on global menu + workspace drawer · reviewer nits folding (two-step delete confirm —
a book body is irrecoverable; keyboard-openable own rows; scoped playbook query key). Gate at
review time: 433 files / 2284 tests.
**⏭ CHAD SMOKE (fresh boot, migration 0005 applies itself):** Notebook section shows the 2 verified
books · write an own book · in a workspace chat ask for a web-app plan — Claude should
list_playbooks + read the scaffold book (visible as tool cards) · toggle Notebook capability off →
tools AND the standing line vanish. **Then: mcp/plugin kind forks OR the deferred instructions arc
(trust-order design parked in the module notes).**

## (prev) NEXT ACTION (2026-07-12d): PHASE C "C-AGENTS" BUILT + REVIEWED + FIXED — gate 2212/4-skip, UNCOMMITTED; commit prompt out; next: arc ④ instructions-notebook (rule kind rides it) / mcp-kind forks

**Phase B COMMITTED `40f8111` (port corrected to 8891 — Chad's serial-from-8890 convention, memory
saved). Phase C slice C-agents built to `docs/module-notes/marketplace-kinds.md`** (Explore recon →
builder subagent → reviewer → fixer subagent):
- **Contracts:** `MarketplaceItem.kind: 'skill'|'agent'` · install-status `installedSkillId`→
  `installedId` + nullable version (deliberate spec change) · `AgentItemManifestSchema` (kebab slug
  ≤64 · prompt ≤50k matching the user-create route · tools arrays ≤64×120 · permissionMode clamped
  to default|acceptEdits|plan — bypass unrepresentable).
- **Marketplace leaf:** merge passes skill+agent (mcp/rule/plugin stay filtered w/ WHY — rule waits
  on arc ④, mcp needs owner+carding forks, plugin undefined) · per-kind install-status (agents by
  slug===itemId, D12 workspace-preference) · injected `MarketplaceDeps.listInstalledAgents`.
- **Agents leaf:** `installCloudAgent` (sha verify FIRST, lowercased compare · jszip extract of root
  agent.json ONLY, nothing to disk · slug===itemId enforced · createAgent source/trustTier
  'community'). **Zip-bomb walls in BOTH extractors** (input cap 1MB agents / 10MB skills +
  declared-uncompressed-size guard + post-inflate backstop — the skills ordering flaw was
  pre-existing, swept). ⚠ trustTier gates NOTHING at runtime (reviewer finding) — real safety = the
  tier-independent TOOLS_ALWAYS_REQUIRING_APPROVAL floor + the permissionMode clamp; comments say so.
- **Route:** kind dispatch; non-installable cached kinds FALL THROUGH to bundled (no same-id
  shadowing; 404 indistinguishable from unknown-id) · discriminated install response · SDK regen.
  **UI:** Skill/Agent chip. **Seed:** `scripts/seed-catalog/focus-writer/`.
- **Reviewer: 0 must-fix; 3 should-fixes + nits ALL applied.** Gate GREEN **2212/4-skip**.
  createAgent outbox gap (pre-existing, invariant 8) → spawn_task chip `task_4415a082`.
**C-agents COMMITTED `711c52d`. STANDING COMMIT AUTHORIZATION from Chad (memory saved) — commit
autonomously after gate+review. SAME SESSION follow-ups (all reviewed, gate 2216/4-skip):
`cloud:publish` now loads .env (root cause: script never read it — Chad hit it live) ·
focus-writer@1.0.0 PUBLISHED to Chad's hub · portal gained the PUBLISH-ITEM form (/catalog/publish,
manifest prefill follows kind, shared read-file-base64 helper; 'publish' now a RESERVED itemId in
PublishItemSchema — route-collision guard, hub-side so the CLI path is covered too) · agents
lifecycle now co-commits outbox events (agent.created/updated/deleted; softDelete gained its
missing transaction; installs don't double-emit). ⏭ CHAD E2E SMOKE: app marketplace → Focus Writer
w/ Agent chip → Get → Installed → Agents panel shows it community-sourced; portal → Publish item
form. Then arc ④ instructions-notebook (3 forks in its module notes) — `rule` installs ride it.**

## (prev) NEXT ACTION (2026-07-12c): PORTAL PHASE B BUILT + REVIEWED (apps/cloud-admin-web) — review fixes folding; then gate → commit prompt; next: Phase C / instructions-notebook (arc ④)

**Phase A COMMITTED `fe2d2be`. Chad's admin account LIVE: kaone.kafi@gmail.com ('itskafi',
role=admin, account 1c945a45…) on his running hub — set-password link handed over (dev-mail log).
The hub (`:8890`) + the portal dev server (`:8891`) were left RUNNING for his smoke.**

**Phase B = `apps/cloud-admin-web`** (subagent-built to spec; as-built in
`docs/module-notes/cloud-admin-web.md` §Phase B): Vue3+Vite+vue-query SPA, `/api` proxy → 8890,
sessionStorage-only session, views SignIn/Catalog/CatalogItem/Accounts, 5 DOM tests, registered in
root vitest workspace (+ node-project exclude). Gate GREEN 2190/4-skip AFTER review fixes (fixer also caught platform.ts raw-ZodError→500, same-class sweep).
**LIVE-SMOKED**: bogus sign-in → 401 → hub's anti-enumeration message rendered (portal→proxy→hub
chain proven). **Reviewer: CLEAN, 0 must-fix; 3 should-fixes + nits → fixer subagent** (FileReader
surfacing+abort · file-input clear after publish · hub-side `jsonValidator` wrapper sweeping the
{code,message} envelope onto zod 400s + route test · contracts admin DTO enums w/ mapper normalize ·
qc.clear() on sign-out · clipboard catch · PATCH description 200→280 round-trip fix · empty-state
copy · redundant error casts). **⏭ After fixer: full gate → commit prompt
(`feat(cloud-admin-web): the marketplace admin portal (phase b)` + `fix(cloud): validation-error
envelope` if split feels right — one slice is also fine) → Chad smoke (sign in · browse ·
yank/un-yank · publish a version bump). Then arc ④ instructions-notebook OR Phase C.**

## (prev) NEXT ACTION (2026-07-12b): ADMIN PHASE A BUILT + REVIEWED CLEAN (role column · dual-door · catalog lifecycle) — UNCOMMITTED; next: Phase B the portal app

**Arc ③ Phase A done same day (fork answers: real admin accounts · deprecate-only=yank).** Built to
`docs/module-notes/cloud-admin-web.md` §"Phase A as built": migration `0004_account_role` (additive,
boot-migrator applies to the live volume) · `@vynel/accounts` `roles/` (resolve FRESH + assign, 404
on unknown) · dual-door `requireAdminAccess` (static token OR fresh-read admin account; old
`requireAdminToken` deleted as dead) · registry `admin-catalog.ts` (list-all w/ versions · zod
metadata patch · yank/un-yank lifecycle) · `/admin` +4 routes · `contracts/hub/admin.ts`. Tests:
admin routes (dual door incl. demotion-bites-fresh + member-self-grant-403 + yank kills
browse/download) + roles leaf tests. **Reviewer: CLEAN, 0 must-fix; should-fix (dead code) + 2 nits
APPLIED** (deferred: shared toHubPublisherTier, N+1 note). Gate GREEN (2179/4-skip pre-nit; re-run
pending commit). **⏭ COMMIT: `feat(hub): admin roles + catalog lifecycle (portal phase A)` + docs.
CHAD BOOTSTRAP: restart hub → curl role-grant (in the module notes). Then Phase B: the
`apps/cloud-admin-web` Vue portal.**

## (prev) NEXT ACTION (2026-07-12): DISCIPLINE ROUND BUILT (session lift + cloud-api thin routes) — both REVIEWED CLEAN, gate 2172/4-skip, UNCOMMITTED; then arc ③ cloud-admin-web

**Chad's 4-item queue (2026-07-12): ① session discipline ② cloud-api discipline ③ `apps/cloud-admin-web`
admin portal ④ instructions/notebook.** ①+② BUILT this session, behavior-neutral, full gate GREEN
**2172/4-skip** (+7 new registry leaf tests + 1 accounts leaf test). One unrelated test flaked ONCE
mid-round (name not captured — vanished on two immediate re-runs; watch for recurrence).

1. **① The delegation lift** — `apps/local-api/src/sessions/` cross-domain composition moved into
   **`packages/session/src/delegation/`** (new `./delegation` subpath): `delegate-to-workspace-root` ·
   `delegate-to-leaf-session` · `run-delegation-claim-and-run-tick` · `build-routed-approval-handler` ·
   `resolve-delegation-trace` · `turn-event-broadcaster` (+tests); `resolve-global-root-transcript` →
   `runtime/`. Session deps += channels/workspaces (prod), agents/approvals (dev). Fake-provider
   duplicate CONSOLIDATED (app superset won, `runtime/test-support/`). STAYS at edge with live
   reasons (`docs/module-notes/session.md` §"delegation lift"): compose-session-mcp-servers (LOCKED
   api-side decision) · run-global-root-turn (imports apps/mcp) · global-root-workspace (env) ·
   delegation headers (HTTP wire) · build-schedule-fire-deps (factory) · streams/services/handler-bundles.
   **Reviewer: CLEAN, 0 must-fix; 2 nits applied** (stale comment; importOriginal-spread mock).
2. **② Cloud-api thin routes** — registry now owns `artifact-store.ts` + `publishCatalogArtifact` +
   `catalog-download.ts` (authorize/load + TierTooLow/ArtifactMissing beside the logic); accounts
   owns `resolveActiveAccountTier` (`tiers/`); catalog.ts + admin.ts are parse→core→shape (ETag/304
   + browse's fail-open `?? 'basic'` stay route-side deliberately). As-built:
   `docs/module-notes/cloud-api.md` §11. **Reviewer: CLEAN, 0 must-fix; 2 nits applied**
   (key-format pin comment; resolveActiveAccountTier leaf test added).
3. **③ PLANNED:** `docs/module-notes/cloud-admin-web.md` — Phase A backend (accounts `role` column +
   registry lifecycle fns) → Phase B the Vue portal served by cloud-api → Phase C non-skill kinds on
   desktop. 3 forks for Chad in the doc (admin accounts vs token-only · curated-only · deprecate-only).
4. **④ PLANNED:** `docs/module-notes/instructions-notebook.md` — `packages/instructions` leaf, ONE
   table `instruction_documents` (`mode 'always'|'notebook'`), always-docs injected at the session
   runtime's prompt composition, notebook via a read-only `vynel-notebook` McpFeatureDescriptor + a
   UI section. 3 forks for Chad in the doc (agent writes? · seeded starters? · memory-context overlap).

**⏭ COMMIT PROMPT (2 commits by path):** `refactor(session): lift delegation composition into
@vynel/session` (packages/session + apps/local-api + docs/architecture.md + module-notes/session.md) ·
`refactor(cloud): registry owns artifact store + publish + download gates` (packages/registry +
packages/accounts + apps/cloud-api + module-notes/cloud-api.md §11). The two plan docs + STATE ride
as `docs:`. Then arc ③ Phase A on Chad's fork answers.

## (prev) NEXT ACTION (2026-07-11): CHAD'S 5-FIX ROUND BUILT (voice UX · dictation · attachments · knowledge indexing · memory tags) — memory UI subagent finishing; then full gate → reviewer → commit prompt

**Chad's ask (2026-07-11): vision refresh + 5 fixes. Vision updated (`docs/vision.md` §2 community
members who bounced off Claude Desktop/Code/OpenClaw + the litmus question; §8 tool is FREE,
WORKSHOPS fund it — accounts via the community platform, never a checkout).** Built, gate-green at
each checkpoint (2151/4-skip after slice 4):
1. **Top-bar mic = overlay, always MID-SCREEN** — in-app overlay was already centered; the floating
   `/jarvis` window now parks CENTER (was bottom-right): `tauri-overlay-window.ts` `parkCenter()`.
2. **Composer mic = DICTATION-only** — `use-dictation.ts` (wraps `createCommandRecognizer`; interim
   words stream into the draft; `cancel()` guards send-races), ChatComposer `draft` = `defineModel`
   + `voiceActive` pulse + `notice` line. Talking-with-Claude vs typing-by-voice now distinct.
3. **Chat attachments END-TO-END, both scopes** — workspace pipeline existed but the UI dropped
   files; the ROOT turn had no plumbing. Now: paste/drag-drop/picker → `turn-attachments.ts`
   (client allowlist + 5MB caps, plain-words rejects) → widened MIME allowlist (+pdf/docx/xlsx/
   pptx/text/csv/html/json) → root schema+core carry `attachedImages` (bytes persist under the
   root's user-data D22 layout) → provider per-turn temp DIR keeps REAL filenames → `AttachmentChips`
   on MessageRow + root transcript DTO. Deferred: inline thumbnails (serve-route hookup) · the
   `attachedImages`→`attachments` rename sweep (43 files).
4. **Knowledge indexing REAL on the desktop** — root causes: watchers never restored on restart AND
   `apps/worker` (the only embeddings runner) is launched by NOTHING. Fix: `knowledge-indexing-service`
   in local-api (boot watcher-restore + catch-up scan + 60s in-process embeddings tick). PLUS
   single-FILE sources (`sourceKind`, migration 0003; `source-paths.ts`; picker lists files;
   sdk rename `knowledge.addDirectory`→`addSource` — deliberate spec change) + per-source status
   in the UI via `summarizeKnowledgeDocumentsBySource`.
5. **Memory tags + `context` + file import** (module-notes plan built): `memory_tags` (migration
   0004) · `context` = reserved behavioral tag — `loadWorkspaceContextForSession` injects ONLY
   context-tagged entries once any exist (cap 50; fallback = old top-10-per-kind) ·
   `MEMORY_AGENT_INSTRUCTIONS` teach save-context + UPDATE-don't-duplicate · MCP grew
   `update_memory_entry` + `add_memory_from_file` + `list_memory_tags` · `GET /tags` · one-shot
   FILE import (≤20k chars; bigger → "add to Knowledge" error; watched memory_sources = deliberate
   follow-up) · `memory-maintenance-service` (memory embeddings were NEVER generated — no runner
   registered anywhere; + daily purge).
**Memory UI landed (subagent: MemoryTagsField/FilePickerField/AddMemoryDialog modes/MemorySection
chips). Reviewer: APPROVE, 0 must-fix; should-fixes applied (memory MCP tools now capability-gated
like knowledge — descriptor + spec test; failed file-reads surface in the composer notice; `:`
filename guard; catch-up scan stop-flag). Chad's FIRST BOOT then caught a real one: transformers.js
cached a TRUNCATED MiniLM download inside node_modules (my mock-less test run died mid-download) →
"Protobuf parsing failed" ×50/min. Fixed 4-layer: `configureEmbeddingsCacheDir` →
`.models/embeddings` (env `VYNEL_EMBEDDINGS_CACHE_DIR`, api+worker boot) · corrupt-cache
self-healing (evict+retry-once, no poisoned promise) · both embed ops abort batch with ONE
actionable error when the model itself is down · switched to q8 (~23 MB vs ~90; free — no vector
ever generated anywhere; version suffix unchanged). LIVE-SMOKED: real 384-dim embedding via the new
cache in 16 s. Full gate GREEN 2165/4-skip.**
**Live-smoke catch #2 (Chad's real `search_knowledge` → "Permission denied"): `workspace_capabilities`
is EMPTY on his box — nothing seeds rows, and no-row meant OFF, so knowledge tools (always) + memory
tools (post-review-fix) + the memory session snapshot were ALL silently dead on every fresh install.
Fixed: catalog gained `defaultEnabled: true` (memory + knowledge); `listEnabledCapabilities` +
`listCapabilityStatusForWorkspace` resolve catalog-first (row = explicit toggle override, opt-out
still wins) — no seeding, no migration, panel + composer can't disagree. Spec tests updated
(deliberate spec change). Gate GREEN 2165/4-skip.**
**⏭ REMAINING: prompt Chad to commit (suggest: feat splits per feature + fix(embeddings) +
fix(capabilities) + docs; the PRE-EXISTING root package.json dev-script change [cloud-api in
`pnpm dev`] is from the hub arc — its own `chore`) → Chad smoke: retry the knowledge search in a
workspace chat (should answer now) · paste a screenshot in the MAIN chat · dictate with the composer
mic · add a knowledge FILE · tag a memory "context" then open a fresh session and ask about it ·
confirm the embedding tick logs a clean batch (no protobuf errors).**

## (prev) NEXT ACTION (2026-07-10): M4a BUILT + LIVE-SMOKED + GATE-GREEN (2107/4-skip) — reviewer running; then fold + commit; next: M4b (desktop sync + install)

**🏗 M4a HUB REGISTRY DONE — "the real marketplace data holder" (uncommitted; journal
`.claude/journal/2026-07-10-hub-m4a-registry.md`).** Built exactly to the advisor-vetted plan
below. **✅ LIVE-SMOKED: `pnpm cloud:publish scripts/seed-catalog/email-drafter` published to
Chad's running hub → catalog_items + item_versions rows + 347-byte artifact + sha256 confirmed via
docker psql; migration 0003 applied to the live volume on node --watch reload.** 7 new tests
(registry leaf + catalog routes incl. the fail-closed download gate + the downgrade-defeats-valid-
token staleness defense + republish-immutability). **Reviewer: security core CLEAN (all 4 asks);
1 must-fix + 1 should-fix APPLIED** — a REJECTED republish used to overwrite the artifact bytes
before the 409 (byte-immutability breach): now conflict-check BEFORE the store put + publishItem
Version's 3 writes wrapped in db.transaction; semver regex added. Gate 2108/4-skip. ⏭ **COMMIT:
feat(registry) + docs.** ⚠ M4a has NO in-app payoff by design (proof = CLI + tests); the app
payoff is M4b.
- **Files:** `contracts/hub/catalog.ts` (kind-agnostic DTOs + tierMeetsMinimum) · `packages/registry`
  leaf (schema publishers/catalog_items/item_versions · repos · listCatalog/getCatalogItemDetail/
  publishItemVersion · PublishItemSchema opaque-manifest) · migration 0003_registry · cloud-api
  `artifacts/artifact-store.ts` (seam + fs impl w/ containment + in-memory for tests) ·
  `routes/catalog.ts` (browse/detail/download; access-token'd; download FRESH-tier FAIL-CLOSED) ·
  admin.ts +POST /catalog/publish (admin bearer, base64 ≤10MB) · env CLOUD_ARTIFACT_DIR ·
  `scripts/src/cloud/publish-catalog-item.ts` + `cloud:publish` + `scripts/seed-catalog/email-drafter/`
  (jszip). Chad's `.env` gained CLOUD_PLATFORM_WEBHOOK_SECRET (M3) — CLOUD_ARTIFACT_DIR defaults.

## ✅ THE CLOUD-API + DESKTOP ARC IS COMPLETE (2026-07-10) — D1 · M2a · M2b · M3 · M4a · M4b-1 · M4b-2 all SHIPPED + gate-green (2126/4-skip)

**The full arc from Chad's opening ask is done: a real desktop app, a hosted hub (accounts + access
tiers), and a real marketplace that HOLDS and DISTRIBUTES skills — with email-drafter, published to
the hub, now installable from the app.** M4b-2 (install finale) built + reviewed (APPROVE, no
must-fix; 2 should-fixes folded: itemId path-traversal guard on the FS write + the stale route
docblock) + committed. Commits: D1 `67530d7` · M2a `0757350` · M2b `d6ea770` · M3 `a60815d` · M4a
`39f2d36` · M4b-1 `f403d93` · M4b-2 (this). Journals in `.claude/journal/2026-07-10-*`.
**M4b-2:** hub artifact download (hub-account) → `installCloudSkill` (verify sha256 FIRST, then
extract SKILL.md via jszip [reads only SKILL.md, writes nothing archive-relative; safe-itemId
guard], disk-first then tx, stamps `installedFromSource:'marketplace'`) · `POST /marketplace/install`
dispatches cloud-vs-bundled by cache membership · the "Get" button now installs (was dead even for
bundled). **⏭ Chad's ONE manual check (tests can't prove):** click Get on email-drafter in the app
→ the row should flip to "Installed" after the post-install refetch (annotateWithInstallStatus).
**Next arcs (open, none started):** D2 installer + bundled Node (§9-F) · marketplace update-flow
(catalog version > installed → "update available") · non-skill kinds (agent/mcp/rule) + `kind` on
MarketplaceItem · object storage (R2) + detached artifact signature (own key) · memory
backup/restore · the CLI surface.

## (M4b-1 done — see below)

**M4b-1 (sync + merged browse) backend built to the advisor plan; 49 scoped tests green (incl. the
COLLISION dedup + sync-service status behavior).** Files: contracts MarketplaceItem +`minimumTier?`
+ HubCatalogItem +`latestVersionSha256` (integrity anchor for M4b-2) · marketplace leaf now OWNS
`marketplace_cloud_catalog` (product migration 0002; supersede of D1) + repo (SYNC reads keep
listMarketplaceItems sync) + `sync-cloud-catalog` (full-swap replace/clear) + `resolve-merged-
catalog` (bundled ∪ cached-cloud, dedup CLOUD-WINS, non-skill kinds filtered) + cloud→MarketplaceItem
mapper · resolveCatalogSources stays pure (seam comment repointed) · hub-account client.getCatalog +
session.fetchCatalog (via withAccessToken) · local-api `catalog-sync-service` (status-keyed:
signed-in→fetch+cache · offline→KEEP · signed-out/locked→CLEAR) + wired in server.ts · marketplace
route schema +minimumTier + SDK regen. **⏭ UI subagent a855a157 (Pro badge). Then full gate →
reviewer → commit feat + docs.** ⚠ still no INSTALL (Get button dead even for bundled — M4b-2).
**Chad smoke (when he runs the app):** signed-in → email-drafter (from the cloud) appears in the
workspace Marketplace section (deduped with the bundled one, cloud-wins); product migration 0002
applies incrementally to his dev DB (NO reset — it's an additive table, not a baseline fold).

## M4b PLAN (2026-07-10, advisor-vetted; M4a COMMITTED `39f2d36`+`605e910`) — desktop CONSUMES the cloud catalog

**M4b = the app-side payoff. SPLIT: M4b-1 sync + merged BROWSE (read) → M4b-2 INSTALL (write).**
Map: Explore agent acae9bf. Advisor reshaped it — SIMPLER than feared:
- **⚠ COLLISION (build the test): `email-drafter` is in BOTH the bundled `VERIFIED_SKILL_CATALOG`
  AND the cloud (I seeded it).** Merge naively → 2 rows same itemId → annotate-by-skillId breaks.
  **Dedup by itemId, CLOUD-WINS.**
- **Cache table lives in the MARKETPLACE leaf** (deliberate supersede of D1 "marketplace owns no
  tables" — bundled-catalog premise is retired; name it in the commit). Leaf reads its OWN cache
  (no injection). better-sqlite3 is SYNC → the cache read keeps `listMarketplaceItems` sync.
- **Merge in the LEAF, `resolveCatalogSources` stays pure:** `[...bundled, ...cachedCloud(db)]` →
  dedup(cloud-wins) → annotate. Update the reserved-seam comment to point at the real merge site.
- **Cache the TIER-NEUTRAL row (itemId·kind·publisher·display·category·iconName·recommendedScope·
  minimumTier·latestVersion·artifactSha256·releasedAt·syncedAt) — NOT `canInstall`.** UI shows a
  "Pro" badge client-side from `minimumTier` vs the entitlement; real gate stays server-side.
- **DEFER `kind` on MarketplaceItem, manifest transport, settings.** v1 cloud item = a settings-
  free skill; map it as a skill (skillId=itemId; category 'email' is a valid SkillCategory).
  Merge only kind='skill' cloud rows for now. Add optional `minimumTier?` to MarketplaceItem
  (additive, for the badge).
- **Signed-out → bundled only:** sync service keys off hubSession status — signed-in → fetch
  /catalog + replace cache · offline → KEEP cache (offline browse) · signed-out/locked/not-
  configured → CLEAR cache.
- **⚠ The marketplace "Get" button is DEAD today even for BUNDLED skills** (no install mutation
  exists). So M4b-1 = "cloud catalog flows to the app + appears" (no regression); M4b-2 = "Get
  actually installs, bundled AND cloud" (install first works at all).

**M4b-1 BUILD:** contracts MarketplaceItem +`minimumTier?` · marketplace leaf: schema/cloud-
catalog-cache.ts + repo (sync reads) + sync-cloud-catalog.ts (replace cache) + merge/dedup in
list+get-marketplace-items + cachedRow→MarketplaceItem mapper + product migration 0002 · hub-
account: client.getCatalog(accessToken) + session.fetchCatalog() via withAccessToken · local-api:
catalog-sync-service (status-keyed) + wire · UI: Pro badge · SDK regen · tests (cache repo · sync ·
**merge dedup collision** · route merged). **M4b-2 (next):** manifest-in-zip OR SKILL.md-by-
convention · hub download+verify-sha256+extract(traversal/absolute/symlink-safe, zip-bomb caps) ·
cloud-install path stamping installedFromSource:'marketplace' · install route + `use-install-skill`
mutation + wire the Get button (bundled + cloud).

## (M4a plan — advisor-vetted, executed above)

**M4 = the marketplace registry — "the real marketplace data holder" from Chad's opening ask.
SPLIT: M4a hub-side (hold + distribute) → M4b desktop (sync + merge + install). ⚠ M4a is the FIRST
milestone Chad CAN'T live-smoke in the app — proof = publish CLI + tier-gated-download check
(basic denied / pro allowed) over curl+tests; the app payoff lands in M4b. Advisor-vetted plan:**
- **Download gate reads tier FRESH from the accounts table, FAIL-CLOSED** (never the ~7d-stale
  token claim — highest-stakes staleness spot: paid content). Browse fail-OPEN, install fail-CLOSED
  = the §5 "browse generous, install gated" line.
- **NO per-artifact Ed25519 signature in M4a** (hub serves catalog+bytes over TLS from one box →
  a detached sig protects nothing the SHA-256-in-catalog doesn't; it earns its keep only at the
  object-storage move, and THEN a SEPARATE keypair — never the token key). v1 integrity =
  SHA-256 stored in catalog, M4b recomputes-and-compares from downloaded bytes.
- **Hub gets its OWN catalog DTO** in `contracts/hub/catalog.ts` (itemId, kind, minimumTier,
  versions) — NOT the skill-shaped `MarketplaceItem` (that + the UI merge is M4b's hard problem).
- **`minAppVersion`: STORE, don't ENFORCE** (desktop still reports appVersion '0.0.0' — enforcing
  would reject everything; treat 0.0.0 as dev-bypass until D2 stamps real versions).
- **Filesystem `ArtifactStore` behind a seam** (no infra; route free to return bytes now / a
  redirect at the R2 move). Registry tables leaf-owned (packages/registry, like accounts owns
  refresh_tokens); migration 0003 incremental.

**M4a BUILD ORDER:** contracts/hub/catalog.ts (DTOs + tierMeetsMinimum) → cloud-db... NO: registry
LEAF owns schema (publishers · catalog_items · item_versions [artifactSha256/size, manifestJson,
minAppVersion stored-not-enforced, NO signature col]) + repos → `packages/registry` leaf
(publish-validate + list/get/annotate) → cloud-api ArtifactStore seam + fs impl + catalog routes
(GET /catalog browse[access-token, annotate canInstall via fresh tier, fail-open] · GET
/catalog/:itemId detail · GET /catalog/:itemId/versions/:v/download[fresh-tier FAIL-CLOSED +
sha256] · POST /admin/catalog/publish[admin-token, base64 zip ≤10MB]) → publish CLI
(scripts/src/cloud/publish-catalog-item.ts) → tests (PGlite+temp store: publish→list→tier-gated
download basic-denied/pro-allowed→sha256 matches). v1 catalog = verified/Vynel-Team only;
kind-agnostic (skill|agent|mcp|rule|plugin) seeded with skill(s).

## (prev) M3 COMPLETE + REVIEW-FIXED + GATE-GREEN — COMMITTED `a60815d`+`dcd7a35`, tier-flip Chad-verified

**🏗 M3 TIERS DONE (reviewer: 1 must-fix + should-fixes ALL applied; journal
`.claude/journal/2026-07-10-hub-m3-tiers.md`). Matrix: basic = channels only · pro = all.**
- **MUST-FIX applied — token-type confusion:** the 7-day entitlement JWT authenticated as an
  access token (same key+issuer). Now a `token_use` claim (`access`/`entitlement`) is REQUIRED by
  both verifiers + explicit `algorithms:['EdDSA']`; constants in contracts/hub/entitlements.
- **Webhook replay dedup:** `platform_events` table (migration 0002, event id PK, ON CONFLICT DO
  NOTHING) → exactly-once; `bodyLimit` before HMAC; hex-shape precheck. **user.updated now applies
  email** (23505→409). Shared `isUniqueViolation` extracted.
- **UI/API agree on unproven entitlement:** signed-in tier/features now NULLABLE (null=verify
  failed → UI doesn't gate, matching the permissive daemon).
- **Tests added:** resolveEffectiveTier downgrades · access-verifier-rejects-entitlement (accounts)
  + entitlement-verifier-rejects-access/expired (hub-account, inline jose, no cross-leaf import) ·
  apply-platform-event lifecycle+email-conflict · webhook dedup · feature-gate all 6 mounts.
- **✅ LIVE (Chad's running hub): incremental migrations 0001+0002 applied to the docker volume
  cleanly** (node --watch reloaded to M3; /set-password 200, /platform/webhooks 401-unsigned —
  M3 routes serving). `.env` gained CLOUD_PLATFORM_WEBHOOK_SECRET.
- **⏭ CHAD SMOKE (basic vs pro):** with the hub up, Account shows a **Basic** chip; Schedules/
  Knowledge/Memory menu items show a "Part of Vynel Pro" locked card. To flip: send a signed
  tier.updated webhook (or admin) → sign out/in → chip flips **Pro**, sections unlock. (I didn't
  flip your live account — that's yours.)
- **DEFERRED (reviewer, non-blocking):** gate is HTTP-only (downgrade doesn't stop running
  schedules/watcher; 403s whole tree incl. disable) · dashboard upcomingSchedules ungated read ·
  `kid` two-key rotation · lock-to-sign-in-when-no-entitlement (product call).
- **COMMIT: feat(hub): tiers + entitlements + platform webhooks + gating · docs.**

## (prev) M3 IN FLIGHT — tiers + entitlements + webhooks (Chad's matrix: **basic = channels only · pro = ALL**)

**§9-E RESOLVED (Chad): two tiers — `basic` gets ONLY channels; `pro` gets everything.** Voice
modeled as its OWN feature key, pro-only for now (vision says voice is a channel — if Chad meant
voice-in-basic it's a one-array-entry flip in TIER_FEATURES). Core chat + workspaces are NOT
gated (the app's heart); gateable keys: channels · voice · schedules · knowledge · memory ·
marketplace.

**M3 PROGRESS: backend (slices 1–4 API-side) DONE + FULL GATE GREEN (uncommitted). Built:
contracts/hub/entitlements.ts (HubTier/HubFeatureKey/TIER_FEATURES value map + claims incl.
email/displayName for offline identity) · cloud-db migration `0001_account_tier` (INCREMENTAL —
hub DB live on Chad's docker volume) + tier repo fns · accounts leaf: entitlement-token.ts
(EdDSA issuer, kid header, resolveEffectiveTier lapsed→basic) + apply-platform-event.ts
(idempotent user.created[converges]/updated/tier.updated/removed[disable+revoke-all]) · cloud-api:
platform.ts webhooks (HMAC sha256 over `${ts}.${rawBody}`, 5-min replay window, hex-compare
timingSafe; 503 without CLOUD_PLATFORM_WEBHOOK_SECRET) + set-password-page.ts (inline-HTML GET
/set-password) + entitlementToken on session responses (env: CLOUD_TOKEN_KEY_ID/
CLOUD_ENTITLEMENT_TTL_SECONDS/CLOUD_PLATFORM_WEBHOOK_SECRET) · hub-account: entitlement-verifier
(pinned SPKI) + second keyring entry 'entitlement' + session rework (adoptSession verifies+stores,
verify-fail = sign-in still works w/ features:[] + warn; offline reads STORED entitlement →
identity+tier+features through grace; getEntitlement() seam) · local-api: VYNEL_HUB_PUBLIC_KEY
env (REQUIRED with VYNEL_HUB_URL — superRefine; Chad's .env updated =CLOUD pub key) +
middleware/feature-gate.ts (403 `feature_locked`; PERMISSIVE when no entitlement — deferred
product call) + mounts (schedules both scopes/knowledge/memory/marketplace/voice; channels+chat+
workspaces+skills ungated) + hub schemas tier/features + SDK regenerated. Tests: webhooks contract
(sig/replay/503/lifecycle) + feature-gate (basic 403s, pro+none pass) + patched fixtures.
REMAINING: UI subagent (locked cards + tier chip) in flight → full gate → reviewer → docs →
commit prompt.**

**M3 PLAN (slices, gate-green each; hub DB is LIVE on Chad's docker volume → migrations are
INCREMENTAL from here, 0001+ via drizzle-kit generate — NEVER edit 0000):**
1. **Shared matrix:** `contracts/src/hub/entitlements.ts` — `HubTier='basic'|'pro'`,
   `HubFeatureKey` union, `TIER_FEATURES` value map (contracts ships values elsewhere:
   VERIFIED_SKILL_CATALOG precedent). Entitlement claims type {tier, features[], exp}.
2. **Hub:** accounts kernel gains `tier` (default 'basic') + `tierExpiresAt` nullable
   (migration 0001) · **entitlement JWT** (EdDSA, SAME keypair, `kid` header NOW — reviewer
   precondition before any client pins keys; ~7d exp = the offline grace) issued alongside
   access token on sign-in/refresh (`HubSessionResponse.entitlementToken`) · **platform
   webhooks** POST /platform/webhooks — WE author payloads (zod): user.created/updated/removed +
   tier.updated; HMAC-sha256 signature header + timestamp replay window (CLOUD_PLATFORM_WEBHOOK_
   SECRET env, min 32); idempotent on platformUserId; user.removed → disable + revoke all
   sessions · **set-password PAGE** GET /set-password (tiny inline-HTML form posting to
   /auth/set-password — workshop users never see a terminal).
3. **Desktop:** hub-account verifies the entitlement JWT against a PINNED public key
   (env `VYNEL_HUB_PUBLIC_KEY` base64-PEM for now; D2 installer bakes it), persists the token in
   a SECOND keyring entry ('entitlement') so OFFLINE boots keep features until exp; HubLinkStatus
   signed-in/offline gain {tier, features[]}; daemon exposes `hasFeature` seam.
4. **Enforcement v1:** UI — gated sections (schedules/knowledge/memory/marketplace for basic)
   render a locked card ("Included in Pro") instead of the section; API — the mutating routes of
   gated features check the seam → 403 `feature_locked` (channels stays open on both tiers).
   Signed-out/not-configured = NO gating change yet (app remains usable; the lock-to-sign-in
   moment is a Chad product call, deferred deliberately).
5. Gate → reviewer (security: webhook HMAC/replay, kid rotation, entitlement verify) → docs
   (cloud-api.md §9-E + journal + STATE) → prompt Chad (feat + docs).

**🏗 M2b DESKTOP SIGN-IN DONE (reviewer: NO must-fix; 5 should-fixes ALL applied + nits).**
Review round added: session ops STRICTLY SERIALIZED (op-queue — a daily restore racing sign-out
can't resurrect a cleared vault) · client network-fail now throws typed `HubUnreachableError`
(503 "check your connection", 15s AbortSignal.timeout; restore() still reads non-401/403 as
offline) · hub-session-service cadence ADAPTIVE (offline retries 60s, settled 24h — tested with
fake timers) · locked card gained "Sign in again" (a re-enabled user isn't stranded till the daily
check) · the two missing app-side test files landed (routes/hub not-configured contract +
delegation; service cadence/stop). UI (subagent-built, sibling-idiom): AccountSection (all 5
HubLinkStatus kinds) + SignInForm + DeviceRow(two-step confirm) + composables/hub/* (15s refetch
ONLY while offline) + Account menu item before Application; ChatMainView +'account'.
**✅ LIVE-SMOKED END-TO-END (2026-07-10, Chad's box, demo password 'vynel-demo-2026'):** hub DB =
DOCKER postgres (apps/cloud-api/docker-compose.yml, port 5433, volume `hub-data`; `db:up`/`db:down`
scripts) — no hosted DB yet (Chad). `.env` gained the full hub block (keys via cloud:generate-keys,
admin token, VYNEL_HUB_URL=http://localhost:8890) — server.ts boot VERIFIED live (migrations over
the direct connection, /health ok). Chad's account provisioned (gaurav.subedi40@gmail.com,
'Chad'); set-password + direct sign-in verified; **daemon /hub/sign-in stored the token in REAL
Windows Credential Manager, devices listed (hostname KLONE), and a daemon KILL+RESTART came back
SIGNED-IN from the keyring alone — the log-in-once promise proven.** Probe device revoked.
⚠ The hub must be RUNNING for the app's Account section: `pnpm --filter @vynel/cloud-api dev`
(postgres container survives on its own). ⚠ Invite links have no set-password PAGE yet (curl-only)
— a hub-hosted page is the M3 rider so real users never see a terminal. **Deferred (reviewer-noted):** offline-at-boot shows null identity (persist
w/ M3 entitlement) · initial-status flash pre-boot-check · DeviceRow pending-disable + revoke
error line · keyring load() conflates no-entry/broken-keyring · 404 mapping drops hub message.
**COMMIT: feat(hub-account + /hub + UI) + docs.** Then M3 per cloud-api.md §8 (plans/grants
schema, webhook endpoints [WE author payloads], entitlement JWT claims, daemon hasFeature seam).

## (prev) M2b plan (executed above)

**M2b PROGRESS: steps 1–4 DONE + GATE GREEN (2071/4-skip, exit 0; uncommitted). Built:
`contracts/src/hub/hub-auth.ts` (wire types incl. HubLinkStatus union) · `packages/hub-account`
(client maps hub {code,message}→VynelError subclasses, network-fail throws raw = offline signal;
keyring vault quarantined in vault/keyring-vault.ts, service 'vynel-hub'; createHubSession closure
service — restore() = boot check: 401→vault-clear signed-out · 403→locked+clear · unreachable→
offline keeps vault+identity; devices retry-once-on-401; 6 unit tests) · REAL leaf↔hub integration
test in apps/cloud-api/src/hub-link.integration.test.ts (packages never import apps, so the
pairing test lives app-side; full arc incl. revoke→signed-out, disable→locked) · local-api /hub
routes (getSession/signIn/signOut/listDevices/revokeDevice; x-sdk-name hub.*; NO x-mcp; unset
VYNEL_HUB_URL → not-configured) + hubSession var (factory/app DI) + hub-session-service (boot
restore + 24h re-check) + server wiring (keyring vault, hostname device, appVersion '0.0.0'
placeholder until D2 installer) · SDK regenerated (116 paths, 138 methods, hub namespace;
namespaced.test.ts list updated +hub — deliberate spec change). ⚠ keyring NATIVE store untested on
real Windows (fake-covered; Chad's smoke). REMAINING: step 5 UI (below) + step 6 reviewer/docs.**

**M2b PLAN (execute in order, gate-green each step):**
1. **`packages/contracts/src/hub/`** — the hub wire TYPES (sign-in/refresh/session/device DTOs)
   shared by cloud-api routes AND the desktop client (the co-location argument made real). Zod
   stays app-side; contracts export types only (match existing contracts style — CHECK first).
2. **`packages/hub-account` leaf** (desktop-side "my hub account on this device"): `client/`
   hub HTTP client (injectable fetch, typed against contracts, maps hub error codes) · `vault/`
   `RefreshTokenVault` contract + `@napi-rs/keyring` impl (Windows Credential Manager;
   service 'vynel-hub'; native dep QUARANTINED here like sherpa native.ts) + in-memory fake ·
   `session/` flows: signIn (device desc: hostname/platform/appVersion) → vault store;
   restoreSession = rotate (the BOOT-TIME STATUS CHECK, cloud-api.md §4: 401 → clear vault =
   signed-out; 403 = locked/disabled; network-fail = offline, keep token); signOut; devices
   list/revoke. Status union: signed-out | signed-in{email,displayName} | locked{message} |
   offline. NO enforcement yet (locking waits for M3 entitlements).
3. **apps/local-api:** env `VYNEL_HUB_URL` (OPTIONAL — unset = hub features disabled, routes 404
   or report 'not-configured') · `/hub` routes (GET /hub/session · POST /hub/sign-in ·
   POST /hub/sign-out · GET /hub/devices · DELETE /hub/devices/:id) — thin over the leaf ·
   boot service: restoreSession on boot + ~daily re-check interval (house *-service pattern,
   stop() on shutdown).
4. **`pnpm api:generate`** (SDK gains hub.* — parity gate demands regen) — check how routes
   declare x-sdk-name (describeRoute) and follow it.
5. **apps/local-web:** Account surface (Application section or its own menu item): signed-out →
   email+password form (+ 'accounts are created by your workshop/platform' hint); signed-in →
   account card + devices list with revoke; locked → the message. vue-query per house patterns.
6. Gate → code-reviewer → STATE/journal → prompt Chad (feat + docs commits).
**Watch-outs:** keyring native on Windows (test with fake; real keyring smoke = Chad) · SDK
parity will FAIL until api:generate runs · don't import cloud packages from the product monolith
(contracts/hub is the ONLY shared piece) · hub client must NOT log tokens.

## (prev same day) HUB M2a BUILT (cloud-api + cloud-db + accounts) — COMMITTED

**🏗 HUB MILESTONE 2a — the cloud second system exists (gate 2063/4-skip, +10; reviewer: NO
must-fix, 4 security should-fixes ALL applied + 3 nits; journal
`.claude/journal/2026-07-10-hub-m2a-accounts.md`).** Chad answered "platform sends whatever
payload we need" → the webhook contract is OURS to author (cloud-api.md §9-H updated).
- **`packages/cloud-db`** — hub Postgres kernel, SEPARATE from `@vynel/db` by design: postgres-js
  client (`prepare:false` default), **PGlite `withTestCloudDatabase`** (real pg dialect, in-process,
  NO Docker on the gate) at `@vynel/cloud-db/testing`, direct-connection boot migrator,
  `accounts` table kernel-core (email stored LOWERCASED for case-insensitive unique),
  `migrations-postgres/0000_baseline.sql` (drizzle-kit generated, renamed).
- **`packages/accounts`** leaf (owns refresh_tokens + account_action_tokens schema): argon2id
  (@node-rs/argon2, OWASP params; ambient-const-enum quirk → numeric `2 as Algorithm`), EdDSA
  access JWT (jose), sha256'd opaque secrets, sign-in (anti-enumeration: generic error +
  timing-dummy + status-after-password-proof), **rotateSession = the boot-time account-status
  check** (TRANSACTIONAL claim-based rotation — 0 rows revoked = concurrent replay → FAMILY KILL
  outside the tx [a throw inside would roll the kill back]; disabled → family kill + 403),
  devices list/revoke/signOut, set-password links (invite 7d/reset 30m, single-use claim in one tx
  with password-set + revoke-all), createProvisionedAccount (NEVER self-serve; 23505→409 via
  cause-chain walk), MailSender seam (dev impl logs the link, WHY'd).
- **`apps/cloud-api`** — thin Hono: /auth sign-in·refresh·sign-out·devices·password-reset·
  set-password + /admin/accounts (sha256+timingSafeEqual bearer) + /health; per-email fixed-window
  rate limits (sweep = EXPIRED-only, attacker can't reset live windows — tested); reset route
  answers 202 WITHOUT awaiting issuance (timing side-channel); env.ts = base64-PEM keys
  (`pnpm cloud:generate-keys`), CLOUD_PUBLIC_BASE_URL REQUIRED, binds 0.0.0.0 (hosted).
- **Parity script extended:** every `packages/*/src/schema` file must be in EXACTLY ONE drizzle
  config (`drizzle.cloud-postgres.config.ts` added; double-registration errors).
- **⚠ NOT live-verified:** server.ts boot needs a real Postgres (deploy-time / Neon). Tests cover
  everything else over PGlite (lifecycle + HTTP arc + limiter). **⏭ Deferred (reviewer-noted):**
  `kid` header before the desktop pins the key (M3) · revoked-row retention sweep · pglite out of
  prod deps before the Docker image · expired-token test cases.
- **COMMIT (2 suggested):** `feat(cloud): hub skeleton — accounts auth over postgres` (new
  packages/apps + parity + scripts) · docs/journal/STATE as `docs:`.

## (prev) D1 SHIPPED + CHAD-VERIFIED ("Yup it worked") — hub milestone 2 was next

**🎉 D1 THE REAL DESKTOP APP — built same session Chad said "go", live-smoked by Chad, COMMITTED
`67530d7` (feat) + the docs commit alongside (gate 2053/4-skip, +14; cargo check clean; reviewer
2 must-fix + 3 should-fix ALL applied; journal `.claude/journal/2026-07-10-d1-desktop-shell.md`).**
- **Gateway (`apps/local-api/src/gateway.ts` + `static-web-ui.ts`):** the daemon's front door —
  `/api/*` strip-mount (SDK baseUrl '/api'; Vite proxy REWRITE REMOVED so dev==sidecar paths) ·
  `/voice/*` → voice-daemon proxy (Vite's prod twin; SSE-safe, abort-propagating, actionable 502)
  · built local-web dist served (hand-rolled absolute-root static — serveStatic is cwd-relative;
  traversal-guarded incl. double-encoded, tested) + SPA fallback (html-accepting GETs) · root
  passthrough (voice daemon's brain client). `VYNEL_WEB_UI_DIST` env (default apps/local-web/dist);
  sidecar mode logs at boot. LIVE-SMOKED: / + /jarvis → shell, hashed assets immutable, /api 200,
  /root/turn passthrough, voice 502, traversal 404.
- **Shell (`apps/desktop`):** windows moved config→code (`windows.rs`: `main` 1280×800 + jarvis
  verbatim flags); release = `daemon.rs` sidecar (spawn `node --import tsx` via repo-root walk-up /
  `VYNEL_DESKTOP_REPO_ROOT`, port-probe 8998 = health [api binds LAST], supervised respawn ×3,
  kill-on-exit, abandoned-flag cuts the 60s wait); `frontendDist` = `http://127.0.0.1:8998`; dev
  (`tauri dev`) unchanged — no spawn, Vite URLs. Main-window close exits the app (else hidden
  jarvis keeps a headless process). `--jarvis-only` (voice daemon now passes it on wake-launch)
  opens overlay only.
- **Reviewer must-fixes (both real):** ① the `/voice/*` shadow broke apps/mcp's external `speak`
  dispatch at root paths → ALL out-of-process consumers now dispatch via `/api` (external-server.ts
  string-concats the mount — `new URL(path, base)` DROPS a baked prefix; apps/cli swept too);
  ② stop()-vs-spawn orphan race → single-lock check+store (kills a fresh child if stopping).
- **✅ SMOKE (Chad-verified 2026-07-10: "Yup it worked"):** ① `pnpm dev` + `pnpm --filter @vynel/desktop dev` → REAL app window (Vite) +
  overlay; ② sidecar: `pnpm --filter @vynel/local-web build` + `pnpm --filter @vynel/desktop build`
  → run `apps/desktop/src-tauri/target/release/vynel-desktop.exe` (no pnpm dev running!) → app
  opens, daemon self-spawned, chat works, X quits+kills daemon; ③ voice wake still overlay-only.
  ⚠ watch SSE token-streaming in sidecar mode (gateway returns the api Response directly — should
  stream; the classic proxy-buffering risk doesn't apply, but only a live turn proves it).
- **D2 punch-list:** installer + bundled Node (§9-F) · single-instance + daemon ownership
  (--jarvis-only has no exit path) · Job Object kill-on-close · tauri log plugin · graceful daemon
  shutdown · updater via the hub (§6). Next hub milestone: cloud-api skeleton + accounts (§8 M2).

## (prev) CLOUD-API + DESKTOP DISCOVERY (2026-07-10, same day — decisions folded into the doc)

**Chad opened the next arc: a HOSTED hub (auth · access tiers · marketplace registry · app
updates) + getting to a REAL installable desktop app.** Full discovery written + fork-resolved:
**`docs/module-notes/cloud-api.md`** (read it before touching this arc). Decided same day:
**G** D1-desktop-shell FIRST (Tauri main window hosting local-web + local-api spawned as sidecar
with health-check/restart/clean-shutdown; the jarvis overlay window stays as-is) · **C**
email+password sign-in (argon2id; accounts NOT self-serve — Chad's own platform provisions users
and handles ALL payments; the hub exposes an idempotent server-to-server provisioning API, §9-D)
· **B** hub DB = Postgres (Neon) day one (postgres-phase2.md letterman notes now actionable;
PGlite as the test substrate — no Docker on the gate). Shape: `apps/cloud-api` +
`packages/cloud-db` + `packages/accounts` + `packages/registry` — a SECOND system in the same
monorepo sharing contracts/errors/logger/testing; the product `@vynel/db` is never imported by
it. Marketplace distribution rides the RESERVED `resolveCatalogSources()` seam (cloud catalog
merged with the bundled one + cached locally for offline; artifacts zipped in R2, SHA-256 +
Ed25519 verified on install; downloads tier-gated SERVER-side). Entitlements = signed JWT (tier +
feature keys + limits, ~7-day offline grace, pinned public key), daemon gains a `hasFeature`/
`limitFor` gate seam (NOT `@vynel/capabilities` — that's a user preference). **Second round of
Chad's answers (same day): A hosting = HIS OWN SERVERS** (ship the hub as a Docker image, deploy
when complete) · **H platform integration = WEBHOOKS** (`user.created/updated/removed` +
`tier.updated`; HMAC-signed, idempotent on platformUserId; payload schemas still open) · **I
session lifetime = log-in-once + revocation-on-next-online-contact**: ~1-year ROTATING REFRESH
token in the OS credential store carries "never log in again"; the signed entitlement JWT stays
SHORT (~7d = offline grace); EVERY APP START runs an account-status check — online+revoked →
logged out + app LOCKED to sign-in (local data never touched); offline → cached JWT carries the
app until expiry (Chad's explicit call — do NOT give the JWT itself a 1-year life, that would let
a revoked user run offline for a year). **Still open (§9): E tier matrix + H payload/signing
details (both block milestone 3) · F Node runtime packaging (blocks the installer, milestone 5).**
Vynel auth stays fully separate from Anthropic auth — users buy their own Claude subscription
(vision: never resell models). Discovery doc uncommitted — commit alongside the D1 kickoff or
solo as `docs:`.

## (prev 2026-07-09 evening): FEATURE-SECTIONS ROUND SHIPPED (channels · schedules · knowledge · memory) — Chad still to live-smoke the new sections

**🎉 THE SECTIONS ROUND (same Fable session, Chad away — autonomous finish per his directive).**
Four scope-aware sections under `components/sections/` (SectionScope global|workspace), on the
GLOBAL menu (Chat · Channels · Schedules · Knowledge · Memory · Application) AND the workspace
drawer (WorkspaceSectionPanel delegates; only skills/marketplace/agents remain panel-rendered):
- **Channels** `9203974`: ConnectChannelDialog (Telegram + BotFather guidance; Discord honestly
  "coming soon"; scope select). Reviewer must-fix caught pre-commit: the ONCE schedule path used
  templateKind 'reminder' → 400s (its template demands a channel) AND delivers VERBATIM (no LLM
  turn) — both branches now send templateKind 'custom' + destinationKind 'chat-only'.
- **Schedules** `9203974`: CreateScheduleDialog — Once (15min/1h/tomorrow chips or datetime-local,
  fireAt built at CLICK time not open time) / Repeats (daily/weekly/monthly + time + weekday chips /
  day-of-month 1–28 validated) via pure `utils/schedule-cadence.ts` (cron build + describe + presets,
  tested); rows read as words; pill = pause/resume (schedulesUser.update).
- **Knowledge** (this commit): AddKnowledgeDialog = real directory browser → knowledge.addDirectory
  (scope global|workspace; GLOBAL sources anchor on the chosen/first workspace — every knowledge
  route is workspace-anchored); rows removable (removeSource). ⚠ single-FILE sources need a backend
  change (register route takes a directory) — deliberate deferral, commented in-dialog.
- **Memory** (this commit): entries listed with the API's REAL kinds (person/preference/
  business-fact/recurring-pattern/note); AddMemoryDialog files kind→category/section defaults. ⚠
  memory is WORKSPACE-owned today — the global surface AGGREGATES across workspaces; Chad's
  context/reminder/rules-for-claude tagging + global memory = the planned memory build
  (docs/module-notes/memory.md "tagging + sources") — backend schema work, NOT slipped in.
- Dedupe: `use-scope-label` (workspaceId→name chips, all four sections);
  `use-*-in-scope` composables aggregate the global surface (per-workspace fetch + merge).
  Deferrals (reviewer-confirmed, non-blocking): dialog chrome CSS ~5×-duplicated → a shared dialog
  primitive; a FAILED section query renders as "empty" (all four sections — add error branches like
  WorkspaceView's sessionsErrorText); memory overview reads first page only (50/workspace, WHY
  commented); section `scope` prop captured non-reactively (safe: workspace switch unmounts);
  aggregates re-fetch workspaces.list inside queryFn instead of ensureQueryData.
- ✅ Live-verified via Playwright (dark, global menu, all dialogs; Chad's real "what time is it"
  VOICE message wears the VIA VOICE badge in production). Gate 2039/4-skip at review time.

## (same day, earlier) CLAUDE-IDENTITY CHAT POLISH + ORIGIN BADGES — shipped `7159d3b` · `a8c51b5` · `e85ee2a` · `b29be8e` · `60d9c3f` · `9203974`

**🎉 THE CHAT POLISH ROUND DONE (Chad: "its looking good now"; gate 2009/4-skip; reviewer
approve-after-fixes, all folded; committed this session).** Chad's direction landed:
- **Assistant = CLAUDE, never "Vynel"** (memory [[assistant-is-claude-not-vynel]]): new `ClaudeMark`
  coral-spark glyph (`--claude-mark` tokens, identity-only — gold stays presence-only), welcome hero
  (spark + time-aware greeting via `users.getMe` + command deck: channels + accent-colored workspace
  cards → click opens the workspace), labels "Claude"/"From Claude"/persona-first ("Ava · vynel"),
  composer "Ask Claude…", and the wake-word leaf accepts "hey claude" variants so the UI invitation
  is honest. ⚠ OPEN with Chad: does "no vynel anywhere" cover the PRODUCT name (onboarding wordmark,
  "Vynel Jarvis" window titles)?
- **No chrome over a flowing thread** — Chad killed the identity/channel bar (the earlier
  ChannelPresenceStrip AND its richer one-session replacement are both gone); the hero carries those
  facts on the empty state only.
- **Discord scrolling** (`ThreadStream` rewrite): newest-100 window + reveal-on-scroll-top with
  anchor math (client-side — the wire has NO pagination; real paging = backend change), pinned-only
  live follow, "Jump to latest" pill, own-send always jumps, onMounted bottom-anchor (the stream
  mounts with history preloaded — found live via Playwright). Thread column 760→920, docks 808→968.
- **Claude-Code-style tool cards**: chip "Wrote CLAUDE.md +16 · 2.2s" (± stats, status word only
  when not a clean completion), expanded `ToolCallDetail` (path header + copy, unified diff with
  +/- gutters over shiki `.line` spans, terminal), MCP ids humanized ("speak"), speak renders its
  spoken text (its output is a boilerplate ack — special-cased, WHY in tool-presenters.ts).
- **Workspace rooms identical**: `WorkspaceWelcomeHero` (manager initial in the workspace accent,
  "Ava is on vynel."), manager persona as `assistantName` through ThreadStream/LiveTurn, persona
  composer placeholder.

**🎉 PER-MESSAGE CHANNEL-ORIGIN BADGES SHIPPED (same session; gate 2013/4-skip; reviewer APPROVE,
should-fix folded).** A user row now records HOW it arrived: nullable `chat_messages.originChannel`
('voice'/'telegram'/'discord'; null = app composer) shipped as **INCREMENTAL migration 0001** (the
FIRST — no baseline fold; Chad's live history verified intact, the watcher-restarted API applied it
cleanly). Threading: edges own origin (the core passes through) — `/root/turn`'s existing
`voice:true` also stamps 'voice' (`streams/global-root-turn.ts`); `routeAsChatTurn` stamps its
`channelKind` (structural type in channels-types.ts — no chat import); web/workspace/delegation
paths stay null deliberately. Wire: contracts + chat route schema + the lean `/root/transcript` DTO
(reviewer catch — it would have silently dropped origin) + `api:generate`. UI: a quiet "via Voice"
pill beside YOU on user rows (`MessageRow`, inline glyphs). ⚠ Rows persisted BEFORE the column have
null origin — Chad's original voice message shows no badge; new ones do. MessageRow sits at ~300
lines (the cap) — extract the inline glyphs on next growth. Commit pending Chad's go.

**Other carried deferrals:** hero Voice chip is a static capability (a `/voice` status read would
light it) · settable workspace colors · voice overlay ignores Escape + caption/error overlap · the
workspace sections drawer (Channels especially) is a bare header with no connect/empty-state flow —
its own polish round.

## ⏭ NEXT ACTION (2026-07-08): VOICE-AS-COMMUNICATION SHIPPED — next: slice 3 (route-to-global speak-back) OR Chatterbox OR UI

**🎉 VOICE-AS-COMMUNICATION DONE — Chad-verified live, COMMITTED `79506a2` (feat) + docs commit.**
Chad's ask: a `speak` MCP tool + "voice as a channel with a light fast model." Built end-to-end:
`speak` brain-surface tool (any global session talks) · voice turns run on **Haiku** + a "reply via
`speak`" directive (short spoken answers, no markdown essay) · **ONE voice, played by the ACTIVE
SURFACE** — the overlay plays the daemon's Kokoro WAV itself (the daemon speaker can't reach the device
while the Tauri/WebView2 window holds it; browser AEC kills echo), daemon speaker only on the no-overlay
native loop · browser STT with a **5 s silence endpoint** + recognizer-restart stitching (don't cut the
user off). Full as-built + the hard-won audio pivot: `docs/module-notes/voice-engine.md` §"✅ BUILT
(2026-07-08)". Gate **1975/4-skip**. Reviewer rounds (cancel-hang · deaf-daemon · echo) all applied.
**⚠ Voice needs the daemon (`pnpm dev:voice` / `pnpm dev:full`) + Chrome/Edge/the Tauri overlay.**

**⏭ SLICE 3 (designed, NOT built):** the true two-tier — Haiku ROUTES a heavy request to the global
brain, which does the work and `speak`s back (or async fire-and-notify via the dormant
`@vynel/voice` `RelayTaskNotifier`). Also a SHOULD-FIX: a spoken fallback when a voice turn completes
without calling `speak` (Haiku occasionally skips → silent turn). Then the parked levers below.

## ⏭ (parked) ① Chatterbox TTS experiment · ② smoke the new UI surfaces

**🎉 THE VOICE FEATURE IS DONE — Chad-verified live, ALL COMMITTED (`dd4143e` hybrid · `ea61ba2` docs
· `f1ca405` tauri overlay + kokoro voice · `f5ed591` docs · `f77059f` floating-orb style; tree clean,
gate 1948/4-skip).** The full arc shipped in one day: local
Moonshine wake → the **Tauri always-on-top transparent overlay** (the gold orb floats FREE on the
desktop, no card — Chad's pick) launches/reveals on wake → Web Speech live transcript → `/root/turn` →
**answers in Kokoro via the daemon's `/synthesize`** (speechSynthesis fallback) → follow-ups →
idle-hide. Daemon launches the Tauri exe itself on wake (`VYNEL_VOICE_JARVIS_APP`; Chrome app-window
only when it's missing). Chad's verdict on WebView2's Azure STT: "almost similar to google stt".

**⏭ ① CHATTERBOX (Chad, planned 2026-07-08 morning): the premium-voice experiment.** Direction from
the original voice plan: Chatterbox/LuxTTS as a SELECTABLE TTS backend behind the existing engine
contract (`VoiceEngine`/`SentenceSpeaker` seams — the overlay already swaps voices per-sentence).
Known constraints (docs/module-notes/voice-engine.md): Chatterbox Turbo is **not realtime on CPU**
(GPU-tuned) — likely an optional Python sidecar or an offline/pre-rendered mode; LuxTTS is
"zipvoice-based" and sherpa-onnx ships ZipVoice (voice cloning ~90% of the ask, no Python). Start by
benching what Chad's box can do; wire behind the same interface, never in the critical path.

**🏁 ② UI BACKLOG CLEARED (2026-07-07 overnight autopilot, Chad's "cover beautiful uis everywhere").**
Four moves, each gate-green + code-reviewer-APPROVEd + committed (gate ends **1962/4-skip**, +14; tree
clean at `d61f1a4`):
- **Onboarding wizard `bf3bdba`** — the first-launch 412 now has a real answer: ANY query/mutation
  hitting the gate's `onboarding_required` envelope (QueryCache/MutationCache onError →
  `onboarding-store`) swaps the whole window to `components/onboarding/OnboardingWizard.vue`. Server
  truth drives it (start resumes an in-progress run → `getRunStatus` snapshot picks the step → 7 typed
  step components → done screen → invalidate-everything). Boot failures surface with retry
  (reviewer's catch); step-shared chrome lives ONCE in `WizardStepBody` (:deep home). **Chad can now
  REMOVE `VYNEL_FIRST_LAUNCH_GATE_ENABLED=0` from `.env` — a fresh DB shows the wizard, not a dead
  app.** Note: during onboarding only `/onboarding/*` routes pass the gate, so the skills step labels
  suggestions from their ids (catalog routes are gated — honest limitation).
- **Workspace-create "+" `62e4a8f`** — the switcher menu gained "New workspace…" →
  `CreateWorkspaceDialog` (name + REAL folder browser over `workspaces.listDirectories`: drives, up,
  live listing; the OPEN folder is the selection) → `workspaces.register` → created workspace becomes
  active.
- **Inline approval-card actionKind `5a41819`** — the LiveTurn card now derives the kind CLIENT-side
  via a new web-safe subpath **`@vynel/approvals/action-kind`** (pure `deriveActionKind`, type-only
  imports — reviewer verified no runtime deps reach the bundle). Same single-source function the
  server records with → inline card + notifier can't drift. **The SSE `ChatTurnEvent`
  `approval-requested.actionKind` contract change stays deliberately deferred** (this closes the UX
  gap without touching the wire).
- **Watch-panel polish `d61f1a4`** — status pill (gold-live / ok / danger), task-entry card
  treatment, gold approval-wait banner, Escape-to-close (with stacked-overlay preventDefault
  etiquette shared with the dialog).

**⏭ CHAD TO LIVE-SMOKE (can't be unit-tested):** ① delete `.data/vynel.dev.db*` + drop the
`VYNEL_FIRST_LAUNCH_GATE_ENABLED=0` line → boot → wizard appears, walk it end-to-end (Telegram +
briefing steps are skippable), app opens with the workspace created; ② switcher → "New workspace…" →
browse to a real folder → create → it's active; ③ send a write-y task in Ask mode → the INLINE card
says "wants to run a command"/"wants to create a file" (danger red on Bash); ④ Watch chip → pill
shows Working→Done, task card + approval banner render.

**Honest deferrals (decide with Chad, not slipped in):** voice-settings surface (voice picker / idle
timeout / wake sensitivity) — the daemon is env-driven at boot (`apps/voice/src/env.ts`); a real
settings UI needs a daemon settings API + persistence design first · `approval-requested.actionKind`
on the SSE contract (above) · reviewer nit: `#14171c` on-gold ink now in ~5 files → a `--ink-on-gold`
token sweep someday. UI rules held: fresh design, tokens-only, gold = presence/attention only
(memory `ui-fresh-design-no-v1-porting`).

### (done 2026-07-07) The voice-feature arc, for the record

**🏁 THE BROWSER "JARVIS VIEW" + WEB SPEECH COMMAND STT (committed `dd4143e` + docs `ea61ba2`).** The full hybrid Chad specified: **small local model (Moonshine) wakes → the browser Jarvis
view (real `VoiceOrb`) opens → Web Speech (Google STT) transcribes commands with a live interim
transcript → `/root/turn` SSE → the reply is SPOKEN sentence-by-sentence (browser `speechSynthesis`)
→ follow-ups without re-wake → 15 s silence closes it and the daemon takes the mic back.** Fork
resolutions + as-built map: `docs/module-notes/voice-engine.md` §"✅ BUILT". Gate green **1933/4-skip**
(+15: 3 driver-handoff · 3 overlay-channel · 6 browser-session · 1 failed-start · app-shell mounts the
real overlay). Daemon boot-smoke verified: models load, overlay channel live on 8997, /events replays
state, /session/end answers, client counts tracked. **Code-reviewer ran: verdict "approve after #1" —
the must-fix + both should-fixes + nits ALL applied + tested** (the "stuck handed-off" family: a
Web-Speech-less browser start now fires onEnded → releases the daemon; a wake lost mid-EventSource-
reconnect recovers via the state replay; the SSE heartbeat can't leak on an early abort; a
fast-failing recognition can't hot-spin — 500 ms silent-capture floor).

**How it fits together:** daemon `VoiceSessionDriver` gained `'handed-off'` + a `WakeHandoff` seam;
`apps/voice/src/overlay/overlay-channel.ts` (Hono loopback, `VYNEL_VOICE_DAEMON_PORT` 8997, SSE +
POST /session/end); local-web gained `composables/voice/*` (recognition/synthesis wrappers, the
unit-tested `voice-command-session` machine, `use-voice-session`, `use-voice-daemon-link`) + a Vite
`/voice` proxy (`VYNEL_VOICE_DAEMON_URL`); **`VoiceOverlay.vue` replaced `VoiceOverlayDemo.vue`** (the
last demo surface is gone). No overlay connected → the native Moonshine+Kokoro loop is untouched.
Daemon deafness while handed off IS the cross-process echo defense.

**🔁 SAME-DAY REVISION — THE FLOATING JARVIS WINDOW (Chad: "global overlay like v1, not in the tab").**
Chad's first smoke: daemon+STT+speak all worked via the mic button, but wake answered natively (web
wasn't running) and he expected a GLOBAL overlay. Built same-session: **wake now opens/foregrounds a
chromeless Chrome app-window** (`/jarvis` bare route, shared `VoiceStage`) — Web Speech intact (it
doesn't exist in Tauri WebView2/Electron, which is why NOT the Tauri overlay; that stays the true
always-on-top future). Channel gained `?surface=app|jarvis` + wake-to-jarvis-only targeting +
**pendingWake replay** (same-breath command survives the launch; supersedes the browser-side replay
hack) + "wake-runner-gone" semantics; daemon gained `jarvis-window.ts` (launch via `start` App Paths /
focus via `AppActivate('Vynel Jarvis')`) + a 10 s connect watchdog. Env: `VYNEL_VOICE_JARVIS_WINDOW=1`
default. Gate **1939/4-skip** (+6). **Verified live as far as mic-less possible:** window launched on
Chad's desktop, connected as `surface:jarvis`, daemon logged it. ⚠ Vite can bind IPv6-only
(`[::1]:8999`) — probe/point at `localhost`, not `127.0.0.1`.

**🔬 SAME-DAY PROBE — TAURI OVERLAY UNBLOCKED (Chad's hunch, verified live).** Chad asked whether
Tauri's webview could do near-Google STT so a TRUE overlay is possible. Built a throwaway **wry** probe
(scratchpad `stt-probe/`; Rust 1.96 + WebView2 149 already on the box, 48 s build): **WebView2 HAS
working `SpeechRecognition`** — mic granted, interim results word-by-word, final PUNCTUATED transcript
(Edge's Azure-backed recognizer), `speechSynthesis` spoke (voices list empty at first call — the async
quirk our speaker already warms), `getUserMedia` fine. The old "Web Speech doesn't exist in WebView2"
blocker was stale. Details:
`docs/module-notes/voice-engine.md` §"🔬 PROBE RESULT". Also fixed same-day: JarvisView self-sizes
(`resizeTo` 420×560, bottom-right — Chrome ignores `--window-size` when already running) + EADDRINUSE
on the channel port now fails with an actionable message instead of a raw stack (tested).

**🏁 SAME-DAY BUILD ON THE PROBE (Chad greenlit): `apps/desktop` TAURI OVERLAY + KOKORO OVERLAY VOICE
(committed `f1ca405`; reviewer's must-fix [cancel-during-playback hang], should-fixes, and
nits ALL applied + tested).** The real always-on-top transparent overlay: a
thin Tauri v2 shell (ONE frameless `jarvis` window on local-web's `/jarvis`, `withGlobalTauri`); ALL
behavior in the web view via `composables/voice/tauri-overlay-window.ts` (reveal-on-wake ·
hide-on-settle · park bottom-right · draggable rounded card; Chrome app-window fallbacks preserved).
Daemon unchanged for the window; the channel gained **POST /synthesize → Kokoro WAV** and the browser
speaks through `daemon-speaker.ts` (per-sentence speechSynthesis fallback) — ONE voice everywhere.
Compiled + ran live: window "Vynel Jarvis" on Chad's desktop, connected as the jarvis surface. Run:
`pnpm --filter @vynel/desktop dev` (needs local-web up). ⚠ Chad must RESTART his daemon to get
/synthesize (an old daemon → overlay quietly falls back to the browser voice). Chatterbox stays
deferred (not realtime on CPU). See voice-engine.md §"✅ BUILT same-day".

**✅ LIVE-SMOKED BY CHAD (2026-07-07): "It worked."** Wake → the daemon launched the Tauri overlay →
orb + live transcript + spoken answer, screenshot-confirmed. The floating-orb (no-card) style was his
final pick (`f77059f`). Daemon also now prefers launching the Tauri exe over the Chrome window
(`VYNEL_VOICE_JARVIS_APP`, repo-relative debug-build default).

**Also-deferred (lower priority):** Chatterbox/LuxTTS Python TTS (voice quality); Kokoro-streamed
browser TTS (one consistent voice) behind `SentenceSpeaker`; acoustic KWS wake; user barge-in;
proactive spoken notifications; live chat-thread refresh after a voice turn. See
`docs/module-notes/voice-engine.md` "Deferred". Pre-existing papercut (not this diff): apps/voice isn't
in the repo lint task; `main.ts` trips prefer-const (late-bound driver) + an unknown `n/no-process-exit`
rule if linted directly.

**⚠ PIVOT RECORD (Chad, 2026-07-07): NOT web — a BACKGROUND SIDECAR.** Priority was a background voice
daemon (native mic/speaker), NOT the local-web browser path I'd started. **Engine + loop logic carried over
unchanged**; only the transport pivoted (browser/WS → native audio + a separate process).

**⚠ COMMIT CONVENTION (Chad, 2026-07-07): NO AI identity in commits** — no `Co-Authored-By: Claude` trailer
(memory `no-ai-identity-in-commits`). This session's + all 13 old "Fable 5" trailers were scrubbed from local
history (unpushed — `origin/main` is 28 behind at `2c04ad6`, so nothing published was rewritten).

**Locked decisions:** host = **separate `apps/voice` process** (`@vynel/voice-daemon`), a true sidecar that
hits the brain over **HTTP `/root/turn` (SSE)** · audio I/O = **`node-cpal`** (ONE prebuilt native lib does
mic capture AND speaker playback — verified loads on Chad's Windows box; `speaker` pkg dropped) · session UX
= **multi-turn conversation** (wake → talk freely, no re-wake → **idle-timeout ~15 s of silence → back
asleep**) · listen = sherpa-onnx-node (Moonshine STT + silero-VAD) · speak = sherpa-onnx (Kokoro/piper;
LuxTTS/Chatterbox later) · wake = VAD-segment → transcribe → text-match "hey vynel" (leaf `detectWakeWord`,
NOT acoustic KWS — Moonshine's ~70× realtime kills KWS's efficiency case; KWS a deferred later pass).
**Web/overlay (local-web `VoiceOrb`, `@hono/node-ws`) DROPPED** for now — removed from local-api.

**🏁 INCREMENT 1 DONE — CPU text-to-speech, green + Chad-heard (commit pending this session).**
`@vynel/voice-engine`: `VoiceEngine` contract + `SherpaVoiceEngine` (sherpa-onnx-node; the native lib is
quarantined to `sherpa/native.ts` behind an ambient shim) + pure config mapper + `FakeVoiceEngine`.
`scripts/src/voice/` = model registry + `pnpm voice:fetch-models` (download+extract → gitignored
`.models/`) + `pnpm voice:smoke`. Gate green **1890/4-skip** (+9); reviewer CLEAN (should-fix + nits
applied). **Verified end-to-end on CPU: piper synth RTF ~0.08 (~12× realtime), valid WAV, Chad confirmed
the voice.** Two live-only bugs caught + fixed running it for real: CJS default-import interop (only
`import x from 'sherpa-onnx-node'` works); Windows `tar` reads the `E:` drive-colon as a remote host
(extract with `cwd` + a bare filename).

**🏁 INCREMENT 2a DONE — STT + RTF benchmark, green (commit pending).** Chad asked "how much do we get?"
→ measured on his CPU: **Moonshine STT RTF ~0.014 (~70× realtime), piper TTS RTF ~0.071 (~14×)** — huge
headroom for the always-on loop; realtime-on-CPU premise validated. Landed the real STT half to get it:
`SpeechRecognizer` contract + `SherpaSpeechRecognizer` (Moonshine, via the same `native.ts` boundary) +
pure `buildOfflineRecognizerConfig` mapper + `readWavFile`; registry now covers STT (moonshine entry);
`pnpm voice:bench` reports RTF for any downloaded model (TTS→STT round-trip also verifies STT accuracy).
Note: STT is a SEPARATE `SpeechRecognizer` contract, not "transcribe on VoiceEngine" (cleaner — independent
model + lifecycle). Gate green **1893/4-skip** (+3). Single STT kind today → `if`-guard not a `never`-switch.

**🏁 INCREMENT 2b DONE — silero-VAD, green + verified (commit pending).** `VoiceActivityDetector` contract
+ `SherpaVoiceActivityDetector` (silero, via `native.ts`) + pure `buildVadConfig` mapper. `push(pcm)`/
`flush()` drain sherpa's segment queue → complete utterances (mirrors the leaf's `SpeechSegmenter` shape).
Registry generalized for **bare-file** downloads (silero_vad.onnx, ~630 KB — not a tarball) alongside
archives; fetch handles both. **Verified: fed a 6.63s 16 kHz clip in 512-sample chunks → 1 segment of 6.27s
(silence trimmed).** Gate green **1896/4-skip** (+3). The engine's listening side is now COMPLETE (STT + VAD);
no KWS engine piece (wake is transcribe-based). ⚠ VAD requires **16 kHz** input (it doesn't resample like the
recognizer — the mic feed must be 16 kHz).

**The sidecar, sub-sliced: loop-core ✅ → audio I/O → brain client → main+smoke.**

**🏁 LOOP CORE DONE — the multi-turn state machine, green (commit pending).** Leaf wake-gap closed ("vynel"
variants + mishears vinyl/vinel/… in `WAKE_NAME`, both patterns, tested). `apps/voice/src/loop/`
(`@vynel/voice-daemon`): `VoiceSessionDriver` — a headless state machine `asleep`→`active`→`busy` composing
injected VAD/STT(`transcribe`)/synth + `runBrainTurn` + `SpokenSentenceBuffer` + `detectWakeWord`, with a
`VoiceSessionIo` outbound seam. **Multi-turn conversation:** `asleep` matches "hey vynel" only → `active`
(every utterance is a command, no re-wake) → `idleTimeoutMs` (15 s) silence → back `asleep`. **Two advisor
contracts baked in + tested:** (1) **echo defense** — mic reopens ONLY on `notifyPlaybackDrained()` (the shell
calls it when the speaker truly finished), pending-flag guard for early signals; (2) **v1 cut: no user
barge-in** (mic closed while speaking — Chad-accepted). 7 driver tests + fakes. Gate **1904/4-skip**. **Moved
out of local-api** (was 3a's `apps/local-api/src/voice`) — the web pieces (`@hono/node-ws`, `@vynel/voice*`
deps) were removed from local-api; the driver now lives in the sidecar shell.

**🏁 SIDECAR CODE-COMPLETE + BOOT-VERIFIED (commit pending).** `apps/voice` (`@vynel/voice-daemon`) full:
`env.ts` (Zod) · `models.ts` (resolve TTS/STT/VAD paths + `findMissingModelFile`) · `brain/` (SSE frame
parser + `mapFrameToBrainEvent` + `createBrainClient` POST `/root/turn` → `runBrainTurn` AsyncIterable) ·
`audio/` (`audio-format` resample/downmix/upmix; `cpal.ts` node-cpal wrapper; `audio-shell` mic→pushAudio +
speaker←emitAudio + duration-based drain for the echo gate) · `main.ts` (load 3 engines, open mic, run loop,
degrade if models absent). **Boot-check verified on Chad's box:** all 3 models load (Kokoro 11 voices @24kHz),
node-cpal enumerates devices (**mic + speaker are 48 kHz STEREO** → shell downmixes+resamples to 16 kHz in,
resamples+upmixes 24 kHz→48 kHz out). Pure logic unit-tested (driver 7 · sse-frames 3 · brain-map 5 ·
audio-format 6). Gate **1918/4-skip**. **TWO node-cpal live-boot bugs caught by the boot-check + fixed:**
(a) `.d.ts` is out of sync with the v0.1.1 runtime — it's `createStream(deviceId, isInput, config, cb)`, load
via `createRequire` + a corrected local type in `audio/cpal.ts`; (b) `getDefaultInputDevice()` returns an
OBJECT (`.deviceId`), not a string (README prose lied). Kokoro downloaded.

**🏁 LIVE SMOKE PASSED (Chad, 2026-07-07) — the daemon WORKS.** Run: local-api up (`pnpm --filter
@vynel/local-api dev`) + `pnpm --filter @vynel/voice-daemon dev`, say "Hey Vynel …". **Findings + fixes from
the live run (all committed):** ① node-cpal `createStream` REQUIRES the callback arg even for output (pass a
no-op — omitting throws "not enough arguments"); ② node-cpal `getDefaultInputDevice()` returns an OBJECT
(`.deviceId`), not a string, and the shipped `.d.ts` is out of sync with the v0.1.1 runtime (`createStream`,
not `createInputStream`) — hence the corrected local type + `createRequire` in `audio/cpal.ts`; ③ the whole
pipeline worked first try (mic→VAD→STT), only wake failed — tiny STT mangled "vynel"→"fine", so `WAKE_NAME`
was widened (fine/final/…) + okay/ok greetings dropped; ④ **moonshine-base >> tiny** for accuracy (now the
default); ⑤ a box-average resampler I added DULLED STT (dropped MORE words) — REVERTED to linear (preserves
consonant highs). Diagnostics behind `LOG_LEVEL=debug` (mic rms · VAD segments · transcripts). **Remaining
live-tune (if needed):** `PLAYBACK_TAIL_MS` echo-gate timing; VAD threshold.

**What already exists (don't rebuild):**
- **`@vynel/voice` leaf** (pulled 2026-07-04, journal `.claude/journal/2026-07-04-voice-pull.md`):
  the stateless relay core — `relay/` + `turn-taking/` (ack-library, audio-segmenter, barge-in,
  relay-task-notifier, sentence-buffer, summarize-turn-for-voice, turn-taking-gate, wake-word). Owns no
  tables, no HTTP surface; sole dep `@vynel/providers` (type-only `NormalizedSessionEvent`). It is the
  LOGIC between an audio engine and a turn — the engine itself (`@vynel/voice-engine` + sidecar) was
  never pulled/built.
- **`VoiceOverlayDemo`** (apps/local-web) — the Jarvis overlay ANIMATION, still scripted; the one
  remaining "demo" surface, parked pending the engine. `VoiceOrb` component in `@vynel/ui`.
- **The turn plumbing voice needs is DONE:** channels-style inbound → `runGlobalRootTurn` (a voice
  utterance is just another origin), surface-up approvals (a voice-driven irreversible action cards to
  web — a voice approval flow is a design question for Chad), live delegation watching over SSE, and
  `summarizeTurnForVoice` in the leaf for spoken replies.
- **Vision:** voice/Jarvis is a CHANNEL in the product model (like Telegram) — see `docs/vision.md` +
  memory [[vynel-vision-and-old-project-lesson]].

**Where the last session ended (all committed through `aef5f0c`, local/unpushed, gate 1882):** the full
surface-up approval arc + shared-pipeline unification + SSE live watching — see the 🏁 blocks below.
Deferred follow-ons queued (non-blocking): workspace-chat session-keyed stream channel · stream
re-attach with backoff · Phase-3 spawned-agent Watch chips.

## 🏁 MOVE 6: LIVE DELEGATION WATCHING OVER SSE (2026-07-06) — `b926524`, gate 1882, reviewer-clean

**Chad: "can't we have realtime activity with a stream connection instead of 2.5s/4s?" — built.**
`TurnEventBroadcaster` (apps/local-api/src/sessions — in-process pub/sub; ONE instance in server.ts shared
by createApp [`c.var.turnEvents`] + the delegation service; Phase-2 multi-process swap point = the reserved
`pubsub` package). The tick publishes every ChatTurnEvent on `traceChannelKey(partialSessionId)` via the
runner's new `observer` seam (contained both edges; `onTurnEnded` in a finally). New SSE observe route
`GET /root/trace/:id/stream` (root.streamTrace; ownership via the job anchor; terminal job → immediate
turn-stream-ended; 5s safety poll for the attach race; abort unsubscribes). Web: `fold-trace-stream` pure
fold + `use-delegation-trace-live` (settled fetch + live tail merge, identity-guarded attach lifecycle,
approval-waiting pill) in the Watch panel. **Reviewer must-fix applied:** TanStack re-evaluates
refetchInterval ONLY on query updates → a fully-suspended poll never resumed after a stream drop; fixed
with a slow KEEP-ALIVE poll under the stream (also un-freezes the mid-turn-attach case where settled rows
outrun the overlay) + explicit refetches on the settle/drop paths; lifecycle tests cover drop/settle/
re-target. **Deferred:** stream re-attach after a drop (polling carries the job; reconnect-with-backoff
follow-on) · route abort/safety-poll tests · workspace-chat session-keyed channel (Slice 2 — the 4s poll
stays there for now).

## 🏁 MOVE 5: ROUTED TURNS ON THE SHARED PIPELINE (2026-07-06, Chad's live-smoke feedback) — `8587b04`, gate 1874, reviewer-clean

**Chad's smoke found the real gap: the routed workspace turn was the LAST turn type on the raw drain —
nothing persisted until completion, TOOL CALLS were never persisted at all, the workspace chat was empty
mid-run, and the Watch sidebar only filled at the end.** Fixed by unifying it onto
`consumeSessionEventStream` (the session-unification direction): the task row lands at session-started
("From Global" + trace-keyed via the consumer's new `messageAttribution` option), the reply grows
chunk-by-chunk, tool calls/thinking persist live. `recordDelegatedRootMessages` + the orchestration drain
runner RETIRED (drainLeafTurn stays for leaf agents). The approval RECORDING moved inside the pipeline
(`handleApprovalRequested`); `buildRoutedApprovalHandler` is surfacing-only (channel push + wait gate +
`abandonParked`); the denial breaker relocated into `delegate-to-workspace-root` (tested) + interrupt-on-
throw fail-closed. Trace entries carry live `toolCalls` (panel renders them); in-flight rows expose
`workspaceId` (workspace chat polls 4s while a routed turn streams into it). UX rules from Chad this
session: **Watch chip = work on ANOTHER session** — global thread shows chips (incl. the in-flight banner
pill, `7e11849`), the workspace's own transcript never does (`ef1b5ff`; chips return there for Phase-3
spawned agents). Routed segments keep hidden/no-auto-title presentation. Commits this batch: `7e11849` ·
`ef1b5ff` · `8587b04`. **⚠ Deferred:** token-level SSE streaming of a background turn into the panel
(polling reads the growing rows — good enough now); breaker logic exists twice (drain for leaf agents,
delegate for routed) — watch for drift; consume-session-event-stream at 323 lines (extract next handler
on next touch).

## 🏁 SURFACE-UP APPROVAL BUILT (2026-07-06) — all 4 moves committed, gate 1874, reviewer-clean

**Shape shipped (Chad's revision): approvals surface on WEB ALWAYS + the ORIGIN CHANNEL (Telegram) when
the flow came from one; decidable from either surface (second decider gets "already handled").** The
routed auto-deny is GONE — replaced by record-and-park for ALL origins. Commits: `2276a4e` (docs) ·
`23f7fc5` (Move 1 mode threading: `delegation_jobs.permissionMode` baseline-folded, `/root/turn` accepts
`mode`, brain turn + routed turns run under it, web sends composer mode on global turns) · `b5c4e9f`
(Move 2 record-and-park: `buildRoutedApprovalHandler` records workspace-scoped + pushes the channel card
+ fail-closed on record-throw; `drainLeafTurn` breaker now counts approval-RESOLVED denials [provider
contract pinned in normalized-session-event.ts]; `routeRequest` wait budget SUSPENDS while parked via
`ApprovalWaitGate`; `recoverStalePendingApprovals` now async + unblocks the parked provider FIRST
[NotFound→post-restart row; other errors keep the row pending] and is WIRED as the 60s
`approvals-recovery-service` — it was called NOWHERE before) · `a17a282` (Move 3: brain-turn cards
pushed to the origin channel via `routeAsChatTurn` → `runRootTurn.onApprovalRequested` →
`GlobalRootDrainSink`; typed-reply correlation stamped) · `949bb05` (polish: cards name the acting
workspace; Watch-panel echo collapse [display-only — the trace read stays faithful]; routed turns get a
read-tool steer via systemPromptAppend). Code-reviewer: no must-fix; both should-fixes applied.

**⏭ CHAD TO LIVE-SMOKE (can't be unit-tested):** ① web: route a WRITE task ("in vynel, create notes.md
with X") in Ask mode → notifier card appears (≤5s poll) → approve → task completes + report bubbles;
deny → task reports it stopped. ② Telegram: send a write task → card arrives in Telegram with buttons →
tap Approve → report arrives in Telegram; also try typed "approve". ③ Telegram brain-card:
"set up a workspace for X at path" from Telegram → register_workspace card in Telegram + web. ④ Let one
card sit ~10min → reaper denies → task resumes with a "couldn't finish" report. ⚠ Baseline was folded
again (`permission_mode`) → **delete `.data/vynel.dev.db*` before smoking** (the stale-dev-DB papercut).

**Deferred-improves (reviewer-noted, non-blocking):** stale pending card after a rare fail-closed deny
(bounded by the reaper; notifier could render better) · timed-out JOB + late park = real card for a
terminal job (pre-existing "result not surfaced after timeout" limitation, now more visible) · fakes
support one approval per instance (multi-approval covered by unit tests only) · delegation-origin
channel cards can't correlate a TYPED "approve" (no inbound row; buttons carry the id — fine on
Telegram) · web notifier card still generic (actionKind contract gap, tracked since M7).

**Goal:** routed tasks (brain → workspace) can DO work with Chad's approval, instead of read-safe
auto-deny. Chad's complaint: "route to workspace: it said routed but the task couldn't perform actions,
and the Ask/Auto/Bypass mode isn't bound."

**Why it's CHEAP in KLONE (the old repo feared a big re-architecture; the hard parts already exist here):**
the provider PARKS a background turn on approval (`build-claude-can-use-tool-callback.ts` awaits a Promise
via `PendingApprovalRegistry`) and resumes on `respondToApprovalRequest`; `resolveApproval` already calls
that; the approval NOTIFIER already polls user-scoped `listPendingApprovalsForUser` (5s) + decides. So a
routed task's RECORDED approval surfaces in the existing notifier automatically.

**The build (green + commit each; drain change → code-reviewer, AI seam):**
1. **Mode threading (no behavior change yet).** Add nullable `permissionMode` column to `delegation_jobs`
   (baseline-fold, pre-release). Thread: `StartGlobalRootTurnRequest.mode` → `run-global-root-turn(-core)`
   holds it → stamp on the in-process delegate app-request (a header mirroring `DELEGATION_ORIGIN_HEADER`
   in `sessions/delegation-origin-header.ts`) → `POST /routing/delegate` reads it → `enqueueWorkspaceDelegation`
   stores it → delegation-service → `runRootDelegationTurn` → `provider.startChatSession({ permissionMode })`.
   Web: `use-chat-turn` sends `mode` for GLOBAL turns too (currently workspace-only). Bind mode to the
   brain's own turn: `run-global-root-turn-core.ts:112` uses `input.mode` not hardcoded `'bypass-with-behavior-gate'`.
2. **Surface-up in the routed turn (ALL origins).** Replace the auto-deny
   (`buildRoutedLeafApprovalDenier`) with **record-and-park**: an api-side handler calls
   `recordApprovalRequest(db, {providerApprovalId: event.approvalRequestId, userId, workspaceId (target),
   sessionId (SDK id, FK-less), parentMessageId, toolUseId: approvalRequestId (chat's placeholder
   convention), toolName, toolInput})` and RETURNS WITHOUT RESPONDING (provider stays parked; a rule match
   inside may auto-approve — that's correct). Web notifier picks it up automatically. If the job carries
   origin channel columns → ALSO enqueue the approval card to that channel (refactor
   `enqueueApprovalRequest` to accept a recipient-target without an inbound row; buttons carry the explicit
   id). `drainLeafTurn` gains `approval-resolved` passthrough; the 2-denial breaker now counts USER
   denials. Suspend `routeRequest`'s WAIT budget while parked (pausable timeout). Wire the
   `recoverStalePendingApprovals` reaper interval in local-api (was never wired — the unanswered bound).
3. **Brain-turn channel push.** Telegram → global-root turn already RECORDS approvals (chat consumer →
   global queue → web notifier); thread `approval-requested` from the drain sink out to `routeAsChatTurn`
   (via `RunGlobalRootTurnInput.onApprovalRequested` + `ProcessInboundDeps`) → the leaf's
   `enqueueApprovalRequest` with full inbound context (typed "approve" correlates). Reply side already
   works (`derive-intent-kind` → `route-as-approval-reply`).
4. **Polish.** Notifier approval-card context for a routed action (workspace + tool + task text). Dedupe the
   duplicate delegation-trace entry (workspace reply + pushed report have the same body). Steer the routed
   agent to read-safe tools (Glob/LS/Read) for read tasks (Noah reached for Bash → denied on "list files").

**Decisions locked (plan doc §"real decisions"):** A=surface-up · B=**ALL ORIGINS — web always + origin
channel** (Chad 2026-07-06; web-only dead) · C=accept parked-holds-serial-slot for v1 + suspend the
wait-timeout while parked; the reaper bounds an unanswered card (~10 min → denied → turn resumes).
**Serial delegation caveat:** a parked routed task holds the single serial slot until decided — fine for
single-user v1.



## 🏁 DELEGATION works end-to-end (Chad-verified live) + tracking layer built (2026-07-06)

**"Route task to workspace didn't work" was TWO things, both now fixed:**
1. **STALE DEV DB (the real blocker).** Chad's `.data/vynel.dev.db` was created 2026-07-04, before several
   schema changes were **baseline-folded** (edited into `0000_baseline.sql` rather than added as
   migrations): `schedule_kind` + nullable cronExpression, nullable `workspaceId`, `primary_sessions`
   rename, etc. Migrations don't re-add baseline-folded columns → the DB was permanently missing them →
   `GET /dashboard/overview` crashed on `no such column: "schedule_kind"`, and the delegation path
   errored server-side. **Fix: deleted `.data/vynel.dev.db{,-wal,-shm}` + restarted → fresh DB from the
   current baseline.** ⚠ **RECURRING PAPERCUT** — baseline-folding wipes Chad's dev DB on every schema
   change now that he RUNS the app. Consider switching to incremental migrations once closer to real use.
   See memory [[stale-dev-db-baseline-folding]].
2. **NO frontend observability (the "didn't see it hit").** The delegation MECHANISM is a byte-for-byte
   faithful match to the old repo (read-safe async queue → `recordPushedReportMessage` push) — NOT a
   regression. But KLONE's fresh UI never ported the old repo's live-tracking. Built it fresh:
   - **Slice 1 (`205c87a`):** `use-in-flight-delegations` polls `root.listDelegations()` (4s) while global
     chat is open → "⚡ Working in {workspace}…" banner + keeps the global thread live (`useSessionDetail`
     gained an optional `refetchInterval`) so the pushed report surfaces within seconds.
   - **Slice 2 (`c7aff25`):** the "Watch X" chip was MISROUTED (passed the delegation `partialSessionId`
     to `root.getSession` → 404). Fixed: `use-delegation-trace` polls `root.getTrace(partialSessionId)`
     (2.5s while pending/claimed) and `SessionViewerPanel` renders the condensed trace (task → reply →
     report) filling in live. Simplified the viewer store to a single key (traces are flat, no drill-down).

**✅ Chad-verified live (screenshot):** created workspace "vynel" (Noah) via `register_workspace` →
"send task to vynel: list all files" → `route_to_workspace` → the delegation RAN → Noah's report bubbled
back into the global thread ("ASSISTANT · NOAH · VYNEL") → the "Watch Noah · vynel" chip appeared.

**READ-SAFE is by design (matches old repo, deferred fork 3).** Noah's report said "I couldn't finish —
a routed task can't perform writes/edits/irreversible actions yet" — because it reached for Bash (carded
→ auto-denied; 2 denials → circuit breaker). Routed tasks are read/analysis-only; the report correctly
tells the user to open the workspace chat to do actions there. **Write-capable delegation = surface-up
approval (brain-tree fork 3), deferred in BOTH repos — a real product decision for Chad.** Minor rough
edge: for read tasks the routed agent reaches for Bash instead of read-safe tools (Glob/LS/Read).

## 🏁 M7 done — desktop UI WIRED to the real API + unit-green. `src/demo/` GONE. ⚠ NOT yet live-smoked.

**Honest status: the code is wired to the real API and unit/typecheck-green, but the integration seam
has NEVER run against a live `local-api` this session** (app-shell test mocks the client; parser/fold are
isolated unit tests; reviewers read, didn't execute). So it's *wired + green*, NOT *verified working* —
Chad's live smoke is the real gate. **All 5 slices done + pushed** (A+B `78bbe2c` · C `ddc275c` · E
`8ff3bbd` · D `6e20489` · journal `5609604`). Full gate **1839/4-skip** (was 1835; +streamer/parser
tests, −demo tests). The demo data layer no longer exists.

**⚙ LIVE-BOOT SESSION (Chad tried to smoke it — three real findings, all fixed/actionable):**
- **`pnpm dev` couldn't boot the API — FIXED (`5609604`-ish commit).** `apps/local-api`'s dev script was
  `tsx watch …`; **`tsx watch` spawns a child whose stdio DEADLOCKS under turbo's output multiplexer on
  Windows** — it never binds 8998 (Vite/web is fine; only the api hung), so the browser got ECONNREFUSED
  everywhere. It boots in 250ms standalone (`pnpm --filter … dev`, inherited stdio) but hangs under turbo
  AND pnpm `--parallel` (both multiplex). Fix: dev script → `node --watch --env-file-if-exists=../../.env
  --import tsx src/server.ts` (Node's watcher runs IN-PROCESS, no child). Verified end-to-end: `pnpm dev`
  → API 200, Web 200, proxy `8999/api`→`8998` 200. **(Gotcha for the whole repo: prefer `node --watch
  --import tsx` over `tsx watch` for any turbo-run dev server on Windows.)**
- **Stale demo `activeWorkspaceId` in localStorage — FIXED (`4d3222f`).** WorkspaceView only auto-picked a
  workspace when the stored id was null; a leftover `demo-ws-bookkeeping` slipped through → 404s. Now
  reconciles any persisted-but-missing id to the first real workspace (or null) once the list loads.
- **Create-workspace — SOLVED via MCP (Chad's pick over a UI form).** No UI switcher-"+" create yet, BUT
  the assistant can now create workspaces conversationally: `register_workspace` is a **brain-surface**
  (`x-mcp.rootSurface: true` — a new generator flag routing a user-scoped tool to `generatedRoutingMcpTools`
  without a `/routing/` path), **mutating → CARDS** (in `vynelRoutingDescriptor.mutatingToolNames`; card
  fires on both global-root surfaces — reviewer-traced). Regen: 34 MCP tools. Gate green, reviewer CLEAN.
  So on a fresh DB, tell the global chat "set up a workspace for X at C:\path" → it cards → creates.
  (A UI "+"→register form is still a nice-to-have; not built.) Files: route x-mcp on `POST /workspaces`,
  `McpExtension.rootSurface`, generator `isRouting || rootSurface`, descriptor mutatingToolNames.

**⚠ TWO LIVE-BOOT PREREQS (checked the files; #2 is a real blocker on a fresh DB):**
1. **Vite `/api` proxy — FINE.** `apps/local-web/vite.config.ts` forwards `/api/*` (wildcard, rewrite
   `/api`→``) to `LOCAL_API_URL` — so `/root`, `/dashboard`, and the SSE turn paths all forward. (The
   `vynel-client.ts` comment listing "/workspaces, /users" is illustrative prose, not an allowlist.)
2. **First-launch gate — now ENV-DRIVEN (was hardcoded on).** The gate (`middleware/first-launch-gate.ts`)
   412s EVERY non-onboarding route until the single local user completes onboarding, and expects the WEB
   CLIENT to catch the 412 and show a wizard — which **local-web does NOT have** (never built). So on a
   fresh `.data/vynel.dev.db` the UI would be dead (412 everywhere). **FIX (done):** `server.ts` now reads
   `enableFirstLaunchGate` from the new `VYNEL_FIRST_LAUNCH_GATE_ENABLED` env (in `local-api/src/env.ts`,
   default `'1'` = ON, production-safe). **To smoke M7: put `VYNEL_FIRST_LAUNCH_GATE_ENABLED=0` in the
   repo-root `.env`** (disables the gate for dev). Building the onboarding wizard is the real long-term
   fix (separate surface, not M7). The gate itself is NOT an M7 regression — pre-existing.
3. **SSE-buffering-through-the-proxy is the #1 live risk** (only a boot reveals it): dev proxies routinely
   BUFFER `text/event-stream`, which makes a turn hang then dump the whole response at once — looks like
   "streaming is broken" though every frame-parser test passes. Chad must watch for INCREMENTAL token
   rendering, not just "the turn completes."

**Minor (STATE note for whoever touches the composer):** `composerModelId` is NOT persisted to
localStorage (only `theme` + `activeWorkspaceId` are) — good, because a stale demo `claude-sonnet-5`
would 400 every turn against the real `CHAT_MODEL_IDS` allowlist. Don't add persistence there without a
validity guard against the current allowlist.
- **A** workspaces + dashboard · **B** chat vertical (reads + live SSE turn + approvals + interrupt) —
  reviewer SHIP-clean. **C** feature sections (5 `enabled`-gated per-domain reads). **E** model picker =
  real `CHAT_MODELS`, model on every turn. **D** files area — LAZY per-directory tree
  (`FileTreeNode` fetches children on expand), ASYNC editor read + real-disk save mutation, truncated/
  binary → READ-ONLY (a partial buffer can't overwrite the file). Reviewer caught + I fixed a HIGH
  data-loss bug (dirty draft A leaked onto file B's disk path via a vue-query undefined-tick →
  `:key="filePath"` fresh-instance-per-file fix) + 2 should-fixes (save-error surface; FileTreeNode
  `workspaceId` getter).
- **Only "demo" left = `VoiceOverlayDemo`** (Jarvis voice ANIMATION — parked pending the voice engine;
  it's UI, not data). `createLocalVynelClient` is just the app's real-client factory name.

**⏭ CHAD TO SMOKE-TEST LIVE (can't be unit-tested):** boot `local-api` + `local-web`, register a
workspace, send a chat message (stream renders? approval card decides?), open+edit+save a file
(persists to disk? alt-tab mid-edit keeps the draft? truncated/binary read-only?), expand a folder
(lazy-loads?). Real data = EMPTY until seeded — an empty first boot is correct, not a bug.

**Deferred-improves logged (non-blocking, Chad's call when):** ① `use-chat-turn.interrupt()` best-effort
catch is silent (app has NO logger layer by design — documented); ② `settleFailedTurn` on a PURE
client-side network drop flashes errored then clears (server errors persist+refetch fine — rare edge);
③ `saveContent` has no ETag/version guard (lost-update if disk changed under a dirty draft — inherent to
the files API contract, not a slice bug); ④ approval `actionKind` absent (contract gap — generic card);
⑤ live delegation drill-down dormant (no per-session-subscribe endpoint — session-viewer reads by-id).

**Next surfaces (parked, not M7):** M6 Tauri shell (own session — long first cargo build) · voice-engine
module (`@vynel/voice-engine`) + sidecar · attachedImages into the turn (composer accepts, not yet sent).

### (superseded below) M7 progress detail

**M7 is sliced (advisor-blessed): A workspaces+dashboard · B chat keystone · C feature-sections ·
D files · E model-picker · F residual cleanup. Green + commit each.**

**🏁 A+B COMMITTED+PUSHED (`78bbe2c`, reviewer SHIP-clean) · C DONE (commit pending).** Full gate
1842/4-skip. The demo namespaces are gone; `workspaces.list`, `dashboard.getOverview`, and the whole
**chat vertical** (reads + live SSE turn + approvals + interrupt) hit the real API. **Slice C:**
workspace drawer feature sections (skills/channels/schedules/knowledge/marketplace) read real
per-domain lists — 5 thin `enabled`-gated composables in `composables/{skills,channels,schedules,
knowledge,marketplace}/`; `WorkspaceSectionPanel` rewired; `fixtures/feature-sections.ts` deleted.
**C field notes:** knowledge `listSources`→`{sources:[...]}` (unwrapped via `select`) exposes
`absolutePath`+`updatedAt` only (NO displayName/documentCount/lastIndexedAt → panel shows folder
basename + path + "updated"); skills installed-row nests catalog under nullable `definition`. C was
self-reviewed (trivial display reads), not a full reviewer pass.
- **Streamer (the one net-new piece):** generated `startTurn` BUFFERS (openapi-fetch resolves the
  whole body) → can't stream. So `composables/chat/chat-turn-stream.ts` calls the typed path-keyed
  `client.POST(path, { parseAs:'stream', signal })` → `ReadableStream` → pure `sse-frames.ts` parser
  (unit-tested: byte-split, terminal `{}`→`turn-stream-ended`) → `AsyncGenerator<ChatTurnEvent>`. The
  `applyChatTurnEvent` fold was UNCHANGED (already typed to the full real 15-member union).
- **Scope split:** workspace=`chat.*(workspaceId)`, global=`root.*()` (user-scoped, NO session list,
  NO workspaceId, NO interrupt endpoint). `use-session-list` global→`[]` (product-correct: one brain).
  `use-session-detail` global→`root.getSession`, workspace→`chat.getSession`. Global thread reads
  `root.getSession(currentSdkSessionId)` NOT `getTranscript` (transcript's lean message type ≠
  `ChatMessageResponse`; getSession is rich + swap-history is a later improve).
- **Approvals:** inline cards route through the EXISTING `useDecideApproval` mutation
  (`approvals.decide(providerApprovalId)` — user-scoped, resolves any of the user's approvals; the
  SSE `approvalRequestId` IS the `providerApprovalId`); stream reflects via `approval-resolved`.
  `use-chat-turn` sheds `decideApproval` entirely. `denied` needs a `reason`.
- **Contracts root-fix (contained — only `@vynel/ui`+web import these):** `ChatSessionResponse.workspaceId`
  → nullable, `ChatToolCallResponse.toolInput/toolOutput` → optional, to match the wire (the API's own
  `ChatSessionSchema` is already nullable; `z.unknown()`→optional key). Zero backend ripple.
- **Deferrals (real API gaps, NOT laziness):** live delegation drill-down (no per-session subscribe
  endpoint — session-viewer dormant on real data, reads by-id via `root.getSession`); approval
  `actionKind` (contract lacks it — generic card); `model` not sent on turns (picker still demo → slice E).
- **Reviewer's 2 deferred-improves (non-blocking):** `interrupt()` best-effort catch swallows (app has
  NO logger by design — documented catch, left); `settleFailedTurn` on a PURE client-side network drop
  flashes errored then clears (server errors persist+refetch fine; genuine rare edge — deferred).
- **Commit msg (pending):** `feat(web): swap workspaces, dashboard, and chat to the real API`.
- **⏭ NEXT after commit:** slice C (feature sections → `client.{skills,channels,schedules,knowledge,
  marketplace}.*` per-section composables; `WorkspaceSectionPanel` fixtures are already contracts-typed).
  Then D (files `client.files.*`), E (model picker → real provider/models or defer), F (delete residual
  `src/demo/` + gate + reviewer). Remaining demo files: `demo-file-store`, `fixtures/{file-trees,
  feature-sections,models}`.

### (original) THE API IS COMPLETE — swap the UI demo seam to real data (M7)

**🏁 API-COMPLETION MISSION DONE (2026-07-05, agent-driven waves; journal
`.claude/journal/2026-07-05-api-completion.md`).** Every remaining source route group is ported,
mounted, typed, gated, reviewed (CLEAN after 1 must-fix closed), and committed — 7 commits
`512de7a..4a5c31a` (local, unpushed). **Surface: 109 paths · 131 SDK methods · 22 namespaces ·
33 MCP tools** (29 main + 4 routing in the global-root-only array). Full unfiltered `pnpm test`
green: typecheck 64/64 · parity · **1835 passed / 4 skip**. Boot smoke: 109 live paths; schedules +
channels + **delegation** services all start.

**What landed on top of the previous state:** chat (12 + `chat-turn` SSE) · root (6 +
`global-root-turn` SSE + trace) · routing (4 + claim-and-run tick + `services/delegation-service`)
· workspaces/memory/agents/capabilities/users/files · providers (+`packages/providers/src/status/`)
· `@vynel/onboarding` (decoupled leaf, `OnboardingDeps` injection, first-launch gate behind
`enableFirstLaunchGate` — server-only) · approvals workspace+rules (user queue → `user-scoped.ts`)
· `GET /dashboard/overview` (net-new, models the UI demo aggregate). **Plus the class fix: response
schemas on every JSON 200/201** (description-only responses made the whole SDK return
`Promise<never>` — only knowledge was typed) + the generator path-param typing fix.

**⏭ For Chad (the M7 swap, per `docs/module-notes/desktop-ui.md`):** delete `src/demo/`, regen, adapt
per-namespace. Already discovered at the seam (fixed in-tree): workspaces list = **bare array** on the
real wire; dashboard `recentSessions[].workspaceId` is **nullable** (null = global-root). `GET
/sessions` returns `ChatSessionListItem` (adds `lastMessagePreview`). Still owed to the UI:
**`ChatTurnEvent` `approval-requested` lacks `actionKind`** (contracts change — do deliberately).

**Deferred (non-blocking):** CLI mirrors for the 14 new namespaces (mission was "api only") ·
route files >300-line sweep (chat/index.ts 397 worst; `files/` shows the sub-router split) ·
onboarding outbox events (faithful-absent) · desktop observation on the web root turn (no
desktop-control in local-api) · the pre-existing integration-test seam. **Autopilot learnings**
(network-drop agent casualties, workflow-resume cache miss vs live rewriters) are in the journal.

## (previous) 2026-07-04 autopilot — the remaining-leaves mission
**🏁 The "remaining leaves" autopilot finished GREEN.** All 5 leaves landed as per-feature verticals
(voice · skills · channels · schedules · marketplace), each pull → decouple → scope-improve → HTTP API →
full-gate → code-reviewer → commit. Suite **1462 passed / 4 skip**; **10 commits `0194ec3..3a92ed5`**
(local, unpushed — matches the recent local-only cadence). Journals: `.claude/journal/2026-07-04-{voice,
skills,channels,schedules,marketplace}-pull.md`. Chad's two notes both delivered: **global-or-workspace
scope** (channels + schedules `workspaceId` nullable) and **two schedule kinds** (recurring cron vs one-time
`fireAt`, create exposes both — the source already implements it; the explicit `scheduleKind` column is a
deferred legibility improve, Chad's call).

**The APIs Chad can build UI on now** (typed SDK, `apps/local-api`): `client.skills.*` (8) · `client.channels.*`
(9) · `client.schedules.*` (8) · `client.marketplace.*` (2). All workspace-scoped under `/workspaces/:id/…`.
**✅ BOOT-SMOKE VERIFIED** (not just `pnpm test`): `pnpm --filter @vynel/local-api dev` boots clean (migrations
run, DB created), `GET /openapi.json` → 200, all 34 new routes live in the spec, marketplace→skills composes at
boot. **Boot prereq (papercut):** the default `DB_PATH=.data/vynel.dev.db` dir must EXIST first — better-sqlite3
won't mkdir it. I created `.data/` (gitignored, so it's there on this machine); a fresh clone needs `mkdir .data`
first. Cheap real fix (deferred, out of mission scope): `mkdirSync(dirname(path),{recursive:true})` in
`packages/db/src/client.ts createSqliteDatabase`.

**Deferred to the session Slice-3 app-wiring** (the SAME app-wiring already owed for delegation SSE sinks;
they compose env-coupled/turn-firing machinery a leaf can't own — NOT gaps, deliberate deferrals):
- **Poll-tick worker bodies**: `run-channel-{polling,delivery}-tick`, `run-schedule-claim-and-fire-tick`
  (worker cron; provide the real injected `resolveApproval`/`startChatTurn`).
- **`POST /schedules/:id/fire-now`** (route 9/9) — needs `composeSessionMcpServers` + `vynelWorkspaceDescriptor`;
  lands as 1 route + a `FireScheduleDeps` binding.
- **Injection-cast reconciliation** at wiring: channels `resolveApproval` (workspaceId string→user-scope adapter),
  the contracts-`ChatTurnEvent` (wire) → runtime-event cast at the polling tick.
- **⚠ Global scope is SCHEMA-READY but NOT YET API-REACHABLE** (Chad — this is the consequence of your
  global-or-workspace note). The schema + core ops accept null `workspaceId`, BUT the channels/schedules HTTP
  routes are ALL workspace-scoped: `create` takes `workspaceId` from the URL path, and `list` filters
  `WHERE workspaceId = ?`. So via the API you'll build UI on, a **global** channel/schedule is currently
  **uncreatable and invisible** — a "remind me in 20 min" global reminder can't be made through the API yet.
  Cheap close (when you decide the UX): a user-scoped `/channels` + `/schedules` create/list, using knowledge's
  in-repo precedent — a `scope: 'global'|'workspace'` body param → `scope === 'global' ? null : workspaceId`
  (see `apps/local-api/src/routes/knowledge` `POST /sources`). Small change; the data model is already there.
- The cross-feature `schedule-channel-delivery.integration.test` (relocate to the app composition layer).
- **CLI commands** for the 4 features (deferred mission-wide — a nicety, not UI/parity-critical; mirror
  `apps/cli/src/knowledge-commands.ts`).

**Deferred improves** (mission-wide, non-blocking): stale kernel-location doc-comments in the new leaves'
`repositories/*` + `schema/index.ts` (name the old `@vynel/db/...` home).

## 🔨 FINISH-EVERYTHING pass (2026-07-05) — Chad: "complete them all, no deferring"
Clearing every deferred item. Progress (TaskList #7-13):
- ✅ **Explicit `scheduleKind` column** — replaced the `@once` sentinel with a `scheduleKind:'recurring'|'one-time'`
  column + nullable `cronExpression`; `isOneTimeSchedule` reads the column; response surfaces it. Baseline-folded
  (zero-data → the migration-0029 risk the sentinel dodged no longer applies). drizzle "No schema changes"; gate
  **1463**; reviewer CLEAN (no-must-fix). `ONE_TIME_CRON_SENTINEL` removed.
- ✅ **Global-scope user-scoped routes** — added `/channels` (`channelsUser.*`, 10) + `/schedules`
  (`schedulesUser.*`, 7) at the root; global (null-workspace) + cross-workspace resources now creatable/
  listable/manageable. New userId-scoped core ops (getChannelForUserOrThrow + thin user-ops; listSchedulesForUser).
  TENANT-isolation test present. Gate **1494**; kept workspace-scoped routes. `.claude/journal/2026-07-05-global-scope-routes.md`.
- ✅ **③ agent-turn MCP binding keystone** — ported `buildInProcessMcpServer` + `vynelWorkspaceDescriptor`
  (apps/mcp) + `composeSessionMcpServers` (apps/local-api/src/sessions). Wraps the 16 generated tool factories
  in `createSdkMcpServer` (SDK builder, single-site, MCP-layer-allowed); tool-gating aligned to KLONE's real
  registry (7 knowledge tools gated; mutatingToolNames [] = auto-approved). NOT yet wired to a live turn.
  Gate **1517**; reviewer CLEAN. `.claude/journal/2026-07-05-mcp-binding-keystone.md`.
- ✅ **Schedule firing WIRED** (reordered ahead of channels — the schedule fire uses the built workspace-turn
  path). Ported `run-schedule-claim-and-fire-tick`; `buildScheduleFireDeps` binds the ③ keystone +
  `startChatTurn`/`composeSessionCapabilities`; `startSchedulesService` (60s poll, boot); `POST /:id/fire-now`
  (workspace + user, no x-mcp, tenant-guarded). Boot smoke: "schedules service started" → "api listening".
  Gate **1548**; reviewer CLEAN. `.claude/journal/2026-07-05-schedule-firing-wired.md`.
- ✅ **Channel poll + delivery ticks (11a)** — ported `run-channel-polling-tick` + `run-channel-delivery-tick`
  to `@vynel/channels` (were deferred); `startChannelsService` boot service runs poll(5s)+deliver(2s), errors
  scrubbed via `extractErrorMessage` (+ token-scrub regression tests). Leaf pure. Gate **1561**; reviewer CLEAN.
- ✅ **Channel inbound-PROCESSING (11b) WIRED** — ported the global-root turn EDGE into apps/local-api/src/sessions/
  (`run-global-root-turn` + drain sink · `resolve-global-root-conversation` [root→primary rename] · `global-root-
  workspace` · `delegation-origin-header`) + the channels-service processing loop (turnDeps: runRootTurn→
  runGlobalRootTurn, resolveApproval from @vynel/approvals). A channel message → global-root turn (routing-toolless
  direct answer today) → reply. My backend slice GREEN (59/59 backend typecheck · full vitest **1571** · parity);
  reviewer CLEAN. Desktop de-scoped (KLONE boots no desktop reader). Deferred-improve: failed turn is silent to the
  channel SENDER (marked failed+logged, but no error status enqueued back — small UX add in route-as-chat-turn).
- ⚠ **FULL `pnpm test` is RED at typecheck — ONLY on Chad's `@vynel/local-web`/`@vynel/ui` UI WIP** (uncommitted;
  broken component types, e.g. MenuListView.vue missing). NOT my code (backend 59/59 green). Chad must fix his UI
  types for the combined gate to go green. Backend commits verified via `--filter=!local-web --filter=!ui`.
- ✅ **CLI commands** — `vynel {skills,channels,schedules,marketplace} <...>` over the namespaced SDK
  (mirror knowledge-commands); 26 new tests. Reviewer CLEAN (arg-order verified, token-safe — connect not exposed).
- ✅ **Cleanups** — `.data/` boot fix (`createSqliteDatabase` mkdirs the DB dir; test added) + 14 stale
  kernel-location doc-comments swept in channels/schedules/skills (comment-only). Integration-test relocation
  STOPPED (needs an unbuilt seam — exported outbound-queue reader / app-mockable adapter / outbox relay; delivery
  mechanics are unit-covered in-leaf; a deliberate call for Chad, not stubbed).
- 🏁 **FINISH-EVERYTHING PASS COMPLETE** (7 backend commits: scheduleKind · global-routes · ③ keystone ·
  schedule-firing · channel-poll/deliver · channel-processing · CLI+cleanups). Everything Chad listed is done
  except the two honest stops above (integration-test seam · failed-channel-turn sender UX) + the one BLOCKER:
  Chad's UI typecheck must go green.

## ⚠ PARALLEL UI WORK IN TREE (2026-07-05) — coordinate
Chad has an UNCOMMITTED desktop-UI milestone in the working tree: `apps/local-web/`, `packages/ui/`
(`@vynel/ui`), `.claude/journal/2026-07-05-desktop-ui-m1.md`, `docs/module-notes/desktop-ui.md`, + config
(vue-demi allowBuilds, vitest.workspace web project, eslint, .gitignore, package.json, pnpm-lock/workspace).
**Backend commits in the finish-everything pass stage ONLY backend files explicitly (no `git add -A`)** so his
UI work stays intact/uncommitted for him to handle. Combined gate is green. See memory `ui-fresh-design-no-v1-porting`.

**Guardrails that held (for the next autopilot):** main loop owned diff-check + full gate + code-reviewer +
commit; subagents did heavy file work on the main tree (no worktrees); never committed on red; STATE every
module. **The API-vertical recipe:** the source `apps/api/src/routes/{feature}` already exist with KLONE-
identical conventions → faithful PORT + rewire + `x-sdk-name` + `pnpm api:generate`, NOT invention.
**Full plan + the session architecture: `docs/module-notes/session.md`.**

**The keystone is SMALLER than STATE assumed.** The source already did its hard refactor (B0–B2b: SessionSink,
global-root twin collapsed, global-root runner relocated) and **dropped the "one generic runner" goal** as
wrong-shaped. So the pull is a faithful move of already-refactored, scope-specific code — NOT a grand unifier.

**Architecture (owner-confirmed): `@vynel/session` = parent of chat; the turn service returning stream|response.**
`session → chat`/`orchestration`/continuity, all down; chat + orchestration are continuity-FREE (verified) →
**continuity ∈ session is cycle-free**. Monitor was CUT by Chad (removed the one entanglement). The migration
plan's "continuity in core" was a monolith-only cycle artifact decomposition removes. Features (schedules/channels)
decouple turn-firing (outbox / injected dep), never import the runner up (invariant #2).

**`@vynel/session` Slice 1 is DONE — committed `4e12297` (local, unpushed).** Created the package + folded in
the `continuity` concern (13-file logic, byte-faithful) + did the **`root → primary` rename** (table
`primary_sessions`, all identity types/fns/files; filesystem `rootDir` untouched). **Migration folded into the
`0000` baseline** (Chad's call — pre-release/zero-data → edit baseline+snapshot, no rename migration; sets that
precedent). Green: drizzle "No schema changes", parity 30, vitest 1162. Journal
`.claude/journal/2026-07-04-session-slice1.md`.

**Slice 2a is DONE — committed `8118d24` (local): the global-root runner CORE** (`run-global-root-turn-core`
+ `SessionSink` + `root-turn-lock` + `global-root-instructions`) + `session-mode` + the **web-safe 3-surface
barrel** (`.`=mode · `./runtime` · `./continuity` — constraint #1 satisfied). Exposed `markDelegationsSurfacedToRoot`
from the `@vynel/orchestration` barrel (catch-up write-back). Primary rename applied to the runner. Green (vitest
1170), reviewer CLEAN, diff-proven faithful.

**Slice 2b is DONE (commit pending) — the workspace turn machinery.** Lifted into `runtime/`: `start-chat-turn`
(workspace runner) · `run-seeded-swap-session` · `resolve-primary-conversation` · `apply-primary-turn-continuity` ·
`bridge-primary-session-after-turn` · `compose-session-capabilities` (+ `vynel-agent-instructions`) ·
`test-support/fake-ai-agent-provider`. **The MCP "fork" resolved itself** — `compose-session-mcp-servers` +
`resolve-global-root-conversation` + `global-root-workspace` STAY at the apps/api edge (LOCKED `api-side-turn-execution-with-mcp`
/ env-coupled — injected via `resolveTarget`; the 2a core already takes opaque `mcpServers`). **`start-chat-turn`'s home
INVERTED the old plan** (it imports continuity → can't live in continuity-free chat; the monolith cycle dissolves).
New surface: `@vynel/chat/repositories`. Green (typecheck 48 · parity 30/7/8 · vitest 1182, +12) · faithfulness
diff-proven · reviewer COMPLETE. Full as-built: `docs/module-notes/session.md`.

**The `@vynel/session` PACKAGE is now complete** (2a global-root core + 2b workspace machinery + resolvers + composers
+ continuity). **Slice 3 (app-wiring) is DEFERRED until `apps/api` lands:** the SSE sinks
(`streams/{chat-turn,global-root-turn}`), the `delegate-to-*` compositions, `run-delegation-claim-and-run-tick`,
`wrapAppRequestWithOrigin`, the ③ agent-turn MCP binding, `approvals` completion (fold + decouple the `chat→approvals`
seam). **Until then, pick the next module (Chad's call):** the improve queue (`capabilities` vertical-slice → `approvals`
→ `agents` → `files`) or more leaves (`skills`/`channels`/`schedules`).

**Then — Slice 3 (app wiring, when `apps/api` lands):** the SSE sinks (`streams/{chat-turn,global-root-turn}`),
the `delegate-to-*` compositions, `run-delegation-claim-and-run-tick`, origin-wrap. **The ③ agent-turn MCP
binding** rides here (`composeSessionMcpServers` → `startChatSession({ mcpServers })`; desktop-control is the
working `McpFeatureDescriptor` reference; knowledge/memory/chat each still owe one). **`approvals` completion**
(fold + decouple the `chat → approvals` lazy-import seam) pairs with the runners — the injection point
(`start-chat-turn`) arrives in Slice 2. **b-lead owner-forks (later):** event-vocab unification; approval Fork 2
(`surface-up`). Deferred Layer-B vocab: `globalRootSessionId`/`rootSessionId` fields rename when these land.

## ✅ Recently done (most recent first)
- **`@vynel/marketplace` vertical + API (autopilot — LAST remaining leaf)** — table-less leaf (flat), install-
  status coupling to skills DECOUPLED via injection: `MarketplaceDeps.listInstalledSkills` injected by the
  ROUTE (composition point imports `@vynel/skills`); leaf is PURE (deps=contracts/db/errors, zero skills import).
  2 GET routes → SDK `client.marketplace.*`; NO x-mcp (reads = join of already-exposed skills tools). Route
  test's real skills-install is `withHomeDir`-isolated. Gate **1462**; reviewer CLEAN.
  `.claude/journal/2026-07-04-marketplace-pull.md`. **🏁 ALL 5 REMAINING LEAVES DONE (voice·skills·channels·
  schedules·marketplace).**
- **`@vynel/schedules` vertical-slice + DECOUPLE (autopilot, Chad priority #2)** — last big leaf. Schema
  (schedules+schedule-runs) + repos + logic, folded (`lifecycle/firing/queries/rendering`). Decouple:
  `startChatTurn` INJECTED via `FireScheduleDeps` (structural); `ChatTurnEvent`→contracts; **hub reads
  (`getWorkspaceById` owner-checked)→kernel repos, reproduction byte-identical, owner-check intact**; tick
  + cross-feature integration test DEFERRED. **BOTH KINDS ARE FAITHFUL** — source already does one-time
  (`fireAt`+`ONE_TIME_CRON_SENTINEL`, fires-once-disarms) vs recurring (cron); no `scheduleKind` column
  needed (contracts deliberately use the sentinel). drizzle **"No schema changes"**; gate **1412**; reviewer
  CLEAN. **Still owed: workspaceId-nullable scope + schedules CRUD API.** Deferred improve: explicit
  `scheduleKind` column (Chad's call). **scope+API DONE** (`a786cbe`): workspaceId nullable (baseline-folded,
  tenant-safe null-fire path — reviewer-confirmed no regression); 8 CRUD routes (fire-now DEFERRED to Slice-3),
  SDK `client.schedules.*` (8), MCP 3 reads; create exposes BOTH fireAt+cron. Gate **1426**; reviewer CLEAN.
  `.claude/journal/2026-07-04-schedules-pull.md`.
- **`@vynel/channels` vertical-slice + DECOUPLE (autopilot, Chad priority #1)** — new leaf owning channels
  schema (4 tables) + repos + logic, folded (`lifecycle/senders/queries/inbound/delivery/adapters`).
  **First coupled leaf → real decoupling** (invariant #2): `resolveApproval` now INJECTED via
  `ProcessInboundDeps` (structural, like runRootTurn); `ChatTurnEvent` rewired to `@vynel/contracts/chat`
  (verified no Date/string bug); poll-tick runners (`run-channel-{polling,delivery}-tick`) DEFERRED to
  app-wiring (orchestration precedent). Tests converted `vi.mock`→injection, assertions unchanged. drizzle
  **"No schema changes"**; gate **1380**; reviewer CLEAN; zero sibling-leaf runtime import. **Still owed:
  workspaceId-nullable scope improve + channels CRUD API.** `.claude/journal/2026-07-04-channels-pull.md`.
- **`@vynel/skills` vertical-slice (autopilot)** — new leaf owning skills schema+repos+logic, folded
  memory-style (`schema/`·`repositories/`·`lifecycle/`·`settings/`·`queries/`·`internal/`). Schema+repos
  git-mv'd from kernel; logic from source `core/src/skills/`. Leaf-clean (kernel+shared+contracts+
  providers type-only; NO cross-leaf). drizzle **"No schema changes"**; full gate **1311 passed / 4 skip**
  (+70); reviewer CLEAN. Killed the stale `@vynel/core/skills` index header. **Marketplace read-seam:**
  skills publishes `listInstalledSkillsForUserAndWorkspace` for marketplace install-status.
  **API vertical DONE** — ported the 8-route skills surface (source `apps/api/src/routes/skills`, KLONE-
  identical conventions → faithful port) to `apps/local-api`; SDK `client.skills.*` (8) + MCP 2 read tools;
  serializers omit host path; added `@vynel/skills/test-support` (`withHomeDir`) so route tests don't clobber
  real `~/.claude/skills`. Gate **1323**; reviewer CLEAN. `.claude/journal/2026-07-04-skills-pull.md`.
  **KEY MISSION LEARNING:** source `apps/api/src/routes/{skills,channels,schedules}` ALREADY exist with
  KLONE-identical conventions → every API vertical is a faithful PORT + rewire, not an invention. Source has
  NO cli (net-new). API-vertical scope = routes+schemas+serializers+colocated tests+`api:generate`+parity;
  **CLI deferred mission-wide** (a nicety; not UI/parity-critical).
- **`@vynel/voice` leaf pulled (autopilot warmup)** — stateless voice-relay core (ack-library,
  audio-segmenter, barge-in, relay-task-notifier, sentence-buffer, summarize-turn-for-voice,
  turn-taking-gate, wake-word) moved byte-faithfully from `core/src/voice/`; owns no tables; sole dep
  `@vynel/providers` (type-only `NormalizedSessionEvent`). Flat (no fold, correct). No HTTP surface.
  Green — full gate **1241 passed / 4 skipped** (+48); reviewer CLEAN; byte-faithful proven.
  `.claude/journal/2026-07-04-voice-pull.md`.
- **Approval queue HTTP surface in `apps/local-api` (`f2d7db2`)** — the first user-scoped routes: `GET
  /approvals/pending` (→ `listPendingApprovalsForUser`, the global queue) + `POST /approvals/:providerApprovalId/decide`
  (→ `resolveApproval`; 404/409 via global onError). Responses CAST from `@vynel/contracts` `ApprovalRequestResponse`
  (+nullable `workspaceId`) per the approvals convention; regen'd SDK (`client.approvals.listPending()`/`.decide()`,
  9 paths/10 methods); **no x-mcp** (sensitive path). Green (typecheck · parity · vitest 1193, +7 route tests). This
  completes the approval story's backend→API; only the notification UI (Chad's frontend) + the `SessionSink`
  notify-not-deny seam (deferred to the runners' consumers) remain. `docs/module-notes/approvals.md`.
- **files / workspaces / agents concern-fold — via a parallel Workflow (`5517f1e` + `a5d84ff` + `a899f93`)** — folded
  the flat logic of all 3 packages into concern folders (files: `path/`+`operations/`+`activity/`; workspaces:
  `lifecycle/`+`directory/`; agents: `lifecycle/`+`session/`) using a **Workflow pipeline: 3 fold agents (parallel) →
  3 code-reviewer passes** (6 agents, 0 errors). All behavior-neutral (plain-`mv` + import rewires, zero logic change),
  all reviews CLEAN, gate green (vitest 1186). Shared vocab (`*-types`/`*-events` + persona classifiers like
  `manager-name`, `file-content-kind`→operations) placed by cohesion per the approvals pattern. **Fold sweep now
  complete** except borderline `capabilities`/`provider-preferences` (6 files each — "acceptable flat" per the reviewer).
  Journal `.claude/journal/2026-07-04-workflow-fold.md`.
- **`@vynel/approvals` — global approval-queue backend + concern-fold (Chad's "approval" module)** — **concern-fold
  `a719521`** (the flat `src/` logic → `rules/` [evaluate/describe/save/soft-delete/purge] + `requests/`
  [record/resolve/recover/purge]; shared events/types/derive-action-kind at root; git-mv + rewire, green 1186).
  **A `0fe8192`**
  vertical-slice (schema+repos kernel→package, drizzle "No schema changes"); **B (commit pending)** the global-queue
  data layer: `approval_requests.workspaceId` nullable (baseline-folded) so brain/global-root cards PERSIST (were
  dropped — the stuck-card root cause); `listPendingApprovalsForUser` (user-scoped global pending); `resolveApproval`
  user-scoped (`workspaceId` dropped from the contract, userId-only guard) so a brain card can be ANSWERED, not just
  time out. Green (drizzle "No schema changes", vitest 1186, +4); reviewer MUST-FIX (half-widened resolve) CLOSED.
  Backend only — routes/UI/`SessionSink` seam wait on `apps/api` (Chad chose "backend foundation" scope; the seam's
  **notify-not-deny for top-level** decision is recorded). `docs/module-notes/approvals.md` +
  `.claude/journal/2026-07-04-approvals-backend.md`.
- **`@vynel/session` Slice 2b — the workspace turn machinery `9825f68`+`87a6868` (local)** — lifted `start-chat-turn`
  (workspace runner) + `run-seeded-swap-session` + `resolve-primary-conversation` + `apply-primary-turn-continuity` +
  `bridge-primary-session-after-turn` + `compose-session-capabilities` (+ `vynel-agent-instructions`) +
  `test-support/fake-ai-agent-provider` into `runtime/`. MCP composer + global-root resolver + `global-root-workspace`
  STAY at edge (locked/env — injected `resolveTarget`). New `@vynel/chat/repositories` subpath. `start-chat-turn`'s
  continuity dep INVERTS the old "belongs to chat" plan (chat is continuity-free → the monolith cycle dissolves).
  Green (typecheck 48 · parity 30/7/8 · vitest 1182, +12), reviewer COMPLETE, faithfulness diff-proven.
  `docs/module-notes/session.md` + `.claude/journal/2026-07-04-session-slice2b.md`.
- **`@vynel/session` Slice 2a — global-root runner core + web-safe barrel `8118d24` (local)** — pulled
  `run-global-root-turn-core` + `SessionSink` + `root-turn-lock` + `global-root-instructions` + `session-mode`;
  split the package into `.`(web-safe mode) · `./runtime` · `./continuity`; exposed `markDelegationsSurfacedToRoot`
  from `@vynel/orchestration`. Green (vitest 1170), reviewer CLEAN, faithful. Improve tracked: fold collect+mark
  into one `surfaceDelegationReportsForRoot` op. `docs/module-notes/session.md`.
- **`@vynel/session` Slice 1 — continuity foundation + `root→primary` rename `4e12297` (local)** —
  created the keystone package; folded the 13-file continuity logic + git-mv'd its schema/repos from kernel
  (`primary_sessions`); renamed the durable-session-identity concept `root→primary` (filesystem `rootDir`
  untouched). Migration FOLDED INTO the `0000` baseline (Chad's call — pre-release/zero-data). Green: drizzle
  "No schema changes", parity 30, vitest 1162. Architecture: continuity ∈ session, cycle-free (chat+orchestration
  continuity-free); monitor CUT. Journal `.claude/journal/2026-07-04-session-slice1.md` + `docs/module-notes/session.md`.
- **orchestration vertical-slice + fold `c5e0622` (pushed)** — new `@vynel/orchestration`
  (delegation engine); schema+repos git-mv'd from kernel, logic foldered (`leaf`/`agents`/`records`/`queries`/`routing`),
  `resolve-delegation-trace` EXCLUDED (→ session/monitor tier → keeps orchestration chat-free; only cross-dep = `agents`,
  by-design). Behavior-neutral (drizzle "No schema changes"), gate green (typecheck 43 · parity 30 · vitest 1133),
  faithfulness diff-proven. `AgentDefinition` SDK type-dep flagged (type-only; possible improve = re-export via `@vynel/agents`).
  Journal `.claude/journal/2026-07-04-orchestration-pull.md` + `docs/module-notes/orchestration.md`.
- **chat vertical-slice + fold `1568e91`** (pushed) — new `@vynel/chat` (turn
  engine + persistence + history CRUD); schema+repos git-mv'd from the kernel, logic foldered
  (`turn-consumption`/`records`/`history`/`context`), the `start-chat-turn` runner EXCLUDED (relocates to
  session → keeps chat continuity-free). Behavior-neutral (drizzle "No schema changes"), gate green (typecheck
  41 · parity 30 · vitest 1091). Code-reviewed, no blockers. `chat → approvals` lazy-import seam deferred to the
  session pull (paired with approvals' fold). Journal `.claude/journal/2026-07-04-chat-pull.md`.
- **memory vertical-slice + concern-fold `9213dfe`** — memory now owns `schema/`+`repositories/` (moved from
  kernel) + foldered `indexing/queries/lifecycle/session`. Proven pure relocation (drizzle "No schema changes",
  parity 30, symmetric-rename diff). **This is the TEMPLATE** for the remaining improve queue.
- **Improve queue (one-by-one, vertical-slice + fold owed):** `capabilities` (smallest) → `approvals` →
  `agents` → `files` (largest). Audit confirmed NO real architecture violations across the 8 leaves; hubs
  (`workspaces`/`provider-preferences`) correctly keep schema in kernel — don't slice them.
- **Project `code-reviewer` agent created** (`.claude/agents/code-reviewer.md`) — Vynel-tuned, reviews the
  CURRENT codebase vs the vision (leaf-owns-schema, folders, invariants, vertical-slice purity, house-pattern
  vs real-violation). Invoke by name on any diff/move. **Policy call pending (Chad):** bare `Error` for
  internal invariant guards is the house pattern — sweep to typed `InvariantError` codebase-wide, or leave.

## ✅ PROVIDER SEAM LANDED (base shape) — DONE (ledger)
**`@vynel/providers` is DONE + green** (full record: `docs/module-notes/providers.md`). Pulled the AI-seam
runtime (67 files) and restructured the old flat `claude/internal/` into **knowledge-style concern folders**
under `claude/`: **`base/`** (SDK adapter — `claude-agent-sdk.ts` is the SOLE non-test SDK import site + the
raw-SDK-shape fns; an Anthropic changelog change lands here) · `session/` (drive `query()`) · `approvals/`
(permission wiring) · `history/` (persisted reads) · `installation/` (host install/config). `shared/` stays
the SDK-free provider-agnostic contract → a future `codex/` slots in as a sibling. Gate green: typecheck (17
pkgs) + parity (30/7/7·8) + vitest **670 / 4 skip** (providers 23 files / 142 tests). **NOT wired to anything
yet — by design.** Shape saved to memory (`providers-structure`).

**✅ provider-preferences DONE + green** → new **`@vynel/provider-preferences`** (preferences ONLY:
`find`/`get`/`set` default provider; `get` folds in **Claude as the default** via `DEFAULT_PROVIDER_ID`).
Split the old `core/src/providers/` grab-bag by concern (Chad: "preference is not skills") — skills-discovery
+ provider-status ops **left in the old repo** for their own domains. Full record: `docs/module-notes/provider-preferences.md`.

**✅ 8 LEAVES via 2 PARALLEL FAN-OUT WAVES (2026-07-03)** — all faithful package pulls (logic+tests;
schema+repos stay in kernel for now), each by a worktree agent + code-reviewed (all PASS, faithfulness
diff-verified), gate green at each integration. Suite **677 → 1019** (+342).
- Wave 1 `631ceb2` — `capabilities` · `files` · `memory` (vec/FTS live) · `approvals`. Journal:
  `.claude/journal/2026-07-03-leaf-fanout.md`.
- Wave 2 `ae985bb` — `mcp-contract` · `desktop-control` · `contracts` · `agents`. Journal:
  `…-leaf-fanout-wave2.md`. **`contracts` now landed** (Zod schemas by domain, wildcard subpath exports) →
  unblocks skills/channels/schedules/marketplace. **`mcp-contract` landed** → the ③ binding's contract is in.
- **Blocker analysis result:** `config`/`pubsub`/`queue`/`feature-flags` are empty UNUSED stubs — NOT blockers,
  skip until a real consumer needs them.
- **Fan-out GOTCHA (see memory `worktree-fanout-isolation`):** an agent's `isolation:"worktree"` can silently
  not take → it runs in the MAIN tree and moves HEAD to its branch. **Always `git checkout -f main` +
  verify HEAD==main before integrating.**

**⏭ NEXT (keep fanning out + build the keystone):**
1. **More leaves** (contracts is ready now): core-extractions `skills` (~30 files, incl.
   `discoverInstalledSkillsForProvider`), `channels`, `schedules`, `marketplace`, `voice` (check each for
   `pubsub`/`queue` needs — pull those stubs only if a real consumer appears).
2. **`@vynel/session`** — the composition keystone. **Build in ONE focused session** (Chad), NOT fanned out.
   The ③ agent-turn MCP binding + real approval CARD ride on it + `mcp-contract` (now landed). **FOLD
   candidate:** SDK `tool()` `annotations` for the auto-card model.
- **Serial follow-ups for the 8 landed leaves:** the **vertical-slice** (schema+repos kernel→package, full
  knowledge shape) + **routes/sdk/mcp** (high-collision shared surfaces). **provider-status** ops land with the
  provider routes. `users` core-decomp (then `@vynel/core` disappears). Improve-pass: agents' SDK type-dep,
  `xa11y-adapter.ts` (305 lines). "instructions" domain — later (Chad).
- **Deferred FOLD (providers):** audit-adopt new SDK surface through the base — session helpers
  (`listSessions`/`getSessionInfo`/…), `startup()`, `Query.reinitialize()`, new hook events, `dontAsk`/`auto`
  permission modes. Each deliberate, each with a test. Details in `docs/module-notes/providers.md`.

Everything below this line is DONE (context, not to-do).

---

## ⏵ AUTOPILOT UPDATE (overnight 2026-07-02) — knowledge scope + sources
Chad ran an overnight autopilot (full log: `.claude/ceo/memory/autopilot-mission.md`). Landed on
`main`, green + pushed:
- `251e1e2` refactor(core): drop errors + knowledge re-export shims (one import name per package).
- `de11714` refactor(knowledge): group ops into `indexing/queries/lifecycle`.
- `bbb87bc` feat(knowledge): scope + sources source-model **backend** — new `knowledge_sources`
  registry (workspace/global scope); documents gain `sourceId` + `scope` (workspace_id nullable);
  migration `0038` is **data-preserving + behavioral-tested** (`packages/db/src/migrate-knowledge-sources.test.ts`
  seeds a populated old-shape DB → migrates → asserts FTS + vec still return); all repos + core ops
  reworked to the source model (**global-fused search**, watcher-by-source, auto-registered workspace
  source). Design: `docs/module-notes/knowledge-scope-sources.md`.
- `65b3025` feat(knowledge): sources CRUD core ops + path-safety (`registerKnowledgeSource` /
  `removeKnowledgeSource` / `listKnowledgeSources`).
**Gate:** `pnpm test` green — **86 files / 521 tests (4 skip)**, verified directly.

**⏵ KNOWLEDGE STAGE-2 — DONE + green (this session). Knowledge is now user-facing complete.** Add-directory
made user-invocable end-to-end: `FileWatcherService` wired into the local-api DI (boot singleton owned by
`server.ts` — created at boot, `stopAll()` on shutdown, held on `c.var.fileWatcher`; `createApp` makes an
inert default so the generators keep calling `createApp({db,logger})`). 3 routes under
`/workspaces/:id/knowledge/sources`: `POST` (add_to_knowledge), `GET` (list_knowledge_sources), `DELETE`
(remove_knowledge_source). **Auto mode (Chad): the 2 mutating tools expose via MCP with
`x-mcp.mutatingApproved:true` — NO approval card yet** ("we will have the approval improved"). Regen → SDK 7
paths / 8 namespaced methods, MCP 7 tools. CLI: `knowledge add-directory <path> [--global]` / `sources` /
`remove-source <id>`. **Fixed a generator bug** (namespaced-SDK POST-body needed `NonNullable<…requestBody>`
— add-to-knowledge was the first POST-with-body). Golden tests updated (MCP now asserts tool *names*, per the
old follow-up) + 4 new CLI tests. Gate green — 86 files / **528 tests**, parity 30 · mcp · sdk. **Still
deferred to the session/approvals phase:** the ③ agent-turn MCP binding + the actual approval CARD.
**Chad to verify the live flow** (boot local-api, `vynel knowledge add-directory <real dir>`).

**Then the mission continues: PROVIDER → memory** (Chad's order). Agents stall on long runs here (>~9 min) —
keep agent tasks small or do it directly.

**NO DATABASE EXISTS YET (all clean — confirmed by Chad).** No data / no dev `.db` anywhere → the
migration squash was trivially safe (a baseline is just "the schema, once"; no reconciliation). Autopilot
ended; now INTERACTIVE with Chad (he decides forks).

**⏵ SQUASH — DONE + committed `6740f81` + pushed.** The 39 migrations + `meta/` → one hand-verified
`0000_baseline.sql` (drizzle-kit generated → FTS5/vec0/trigger DDL for all three search domains
hand-appended). **Faithfulness PROVEN**: a throwaway oracle dumped a semantic fingerprint (per-table
columns/FKs/indexes via PRAGMA, order-independent; exact text for triggers + virtual tables) of the OLD
39-chain and the NEW baseline — **semantically identical** (30 tables, 5 virtual, 26 shadow, 9 triggers).
Moot `migrate-knowledge-sources.test.ts` → `migrate-baseline.test.ts` (baseline shape + FTS + vec KNN
across chat/memory/knowledge). Dangling `00xx` comments swept. **Erased the `0038` rebuild risk.** New
schema changes after the baseline still need incremental migrations.

**⏵ VERTICAL SLICE — DONE + committed `481ab3e` + pushed + ✅ BLESSED by Chad ("exactly what we need").**
The relocation LANDED GREEN: knowledge's `schema/` + `repositories/` moved from `@vynel/db` into
`packages/knowledge/` (whole domain now reads in ONE tree). 51 files (12 git-mv renames + 39 edits); all 34
importers rewired (33 internal → local, 1 surface → `@vynel/knowledge`); kernel root schema barrel cleaned;
drizzle config carries one cross-package path (`../knowledge/src/schema/*`); parity guard reworked to walk
every `packages/*/src/schema` root. **Tool-proof:** `drizzle-kit generate` → **"No schema changes"**. Gate
green — 524 tests, parity 30 · mcp · sdk, typecheck 24/24. Re-verified post-bless (tree clean, invariants
hold: knowledge imports down-only, no apps/ imports, kernel dirs clean).
- **knowledge is now the TEMPLATE** every future module copies (`packages/<feature>/{schema,repositories,
  +logic}`). Migration *apparatus* stays centralized (one-physical-DB invariant) — a feature owns its schema
  **files** + logic, NOT its migration lifecycle.

**⏵ LOCAL-API RENAME — DONE + green (this session).** `apps/api` → `apps/local-api`, `@vynel/api` →
`@vynel/local-api` (git-mv + full repo sweep: 5 code refs incl. the 2 generator `createApp` imports, ~30
comment/doc path refs, `.env.example`, generator templates; regen kept SDK/MCP consistent). WHY: this one
always runs on the tenant's machine — the **server-level api** (Phase 2) comes later as a separate app. Gate
green — 524 tests, parity 30 · mcp · sdk. **The architecture principle Chad affirmed:** one core function
serves api actions AND cli actions (and the future server-api) — surfaces are thin peers over one core;
sometimes you want the HTTP hop (server-api), sometimes not (local cli).

**⏵ CLI DIRECTION — RESOLVED by Chad: keep api for now, preserve the shape.** "On cli for now use api no
issues but keep that shape we can use in cli directly if needed in future." So `@vynel/cli` stays over
`@vynel/sdk` → HTTP → local-api for now (NO rewrite). The vertical slice already preserves the db-direct
option (core ops take `db`; the worker proves it) — so a future swap to CLI-db-direct is a drop-in when
needed. Open-when-we-do-it Q (deferred): who runs migrations for a standalone CLI (on-open vs assume-migrated).

**⏵ WORKSPACE PULL — DONE + green (this session).** `packages/core/src/workspaces/` (14 ops + events +
types + tests) → **new `@vynel/workspaces` package**. **Hub, not leaf:** its `workspaces` TABLE + repos STAY
in the kernel (`@vynel/db/schema|repositories/workspaces`) — every feature FKs to workspaces, so moving the
table would force cross-feature imports; only the **management logic** moved. Clean move (zero `../` sibling
deps; the logic only reaches kernel repos + `@vynel/errors`); 2 consumer imports rewired
(`apps/local-api` factory + workspace-resolver: `@vynel/core/workspaces` → `@vynel/workspaces`); dep added to
local-api. Gate green — 524 tests, parity 30 · mcp · sdk, typecheck. **This starts decomposing `@vynel/core`**
(now holds only `users` + `_shared`); `users` is the next hub (same pattern), then core disappears.
**Template refined:** *leaf* feature owns schema+repos+logic; *hub* entity (users, workspaces) keeps
schema+repos in the kernel, only logic → package.

**NEXT (mission order): PROVIDER pull** → `@vynel/providers` (the AI seam; `claude-agent-sdk` runtime ONLY
here). Chad's directive: check ALL old provider functions against the latest SDK, cover all available
functions (drop none), then fold. Big module — step-by-step WITH Chad. Then **memory** (+ tagging system).
Smaller pending: knowledge **Stage-2** routes + workspace CRUD routes (surface work); `users` core-decomp.

## Goal
Rebuild Vynel in KLONE by moving tested code from the old KAFI repo **module-by-module** into a clean
modular monolith (**routes-over-packages on Hono** — logic in `@vynel/<feature>` packages, thin api).
Land each feature's **backend** surfaces (api → generators/sdk/mcp → cli/external-mcp → worker) using
**knowledge** as the reference pattern. **Skip web** (Chad reworks it). Green at every step; commit+push each.

## Repos & branch
- **Working:** `E:\KLONE\Workspace\vynel` — git `main`, remote `github.com/kafijunior/vynel-beta`. This session (all pushed):
  `6740f81` squash · `481ab3e` vertical-slice · `048eaab` local-api rename · `56d163e` postgres notes ·
  `c637526` workspace pull · `592e01b` knowledge Stage-2 · (+ docs). Tip advances with each commit.
- **Source (READ-ONLY, never modify):** `E:\KAFI\WORKSPACE\v2\vynel`, branch `refactor/session-library` (tip `754615f`, clean tree). Pull with:
  `git -C /e/KAFI/WORKSPACE/v2/vynel archive refactor/session-library <paths> | tar -x -C /e/KLONE/Workspace/vynel`
- Backups: `E:\KLONE\vynel-backups\*.bundle`.

## Done (green + committed + pushed)
1. **Scaffold** `291622b` — docs + CLAUDE.md + `.claude/{ceo/soul,rules}` + root config.
2. **Knowledge vertical** `0491192` — `@vynel/db` (ALL domains' schema/repos/migrations) + errors, logger, embeddings, indexer, testing, knowledge.
3. **Knowledge api (Step A)** `51c7c20` — `apps/local-api` trimmed to the knowledge route + `@vynel/core` **spine-slice** (users, workspaces, errors, knowledge, _shared).
4. **Generation pipeline (Step B)** `4764700` — `@vynel/scripts` (generators + 3 parity guards) + `@vynel/sdk` (flat `createVynelClient`) + `@vynel/mcp` **producer shell**. `pnpm api:generate` → flat SDK (5 paths) + MCP registry (4 knowledge tools). **AI-seam invariant amended** (agent-SDK *runtime* stays in providers; the SDK's *builder exports* + Vynel's `McpFeatureDescriptor` are allowed in the MCP layer). Deferred to the providers/composer move: `mcp-contract`, `build-in-process-server`, the descriptors, the external adapter (`server.ts`/`env.ts`).
5. **Namespaced SDK (Step C)** `36088b8` — letterman's `client.knowledge.search()` facade: `describeRoute` widened for `x-sdk-name`, the 5 knowledge routes annotated, `generate-namespaced-sdk` (parse/tree/emit) → `packages/sdk/src/generated/namespaced.ts`, composed via `Object.assign` in `createVynelClient`; `SdkError` on non-2xx. sdk-parity now guards `namespaced.ts`.
6. **Response schemas (B)** `a98fc02` — the 5 knowledge routes declare response schemas (`resolver()` on each 200); `Serialized*` types derive from them via `z.infer` (one source, −50 lines). SDK returns are now **typed** (`client.knowledge.search()` → `{ results: […] }`), flat + namespaced. `expectTypeOf` guard per route.
7. **CLI (D)** `77bddc8` — `@vynel/cli`: `vynel knowledge <search|list|get|status|reindex> -w <id>` over the namespaced SDK (`commander`; thin, injectable `buildProgram` for tests; `env.ts` for base URL; `SdkError`→stderr+exit). Verified `--help` end-to-end.
8. **Worker (F)** `d9c6c45` — `@vynel/worker`: faithful pull (env/factory/scheduler) + `index.ts` trimmed to the single `generate-knowledge-embeddings` cron job (node-cron; thin `(db,logger)`→core delegator). Dropped transitive `@vynel/embeddings` + the empty-registry outbox job.
9. **External MCP (E)** `b2842e3` — `@vynel/mcp` external stdio server (`@modelcontextprotocol/sdk`): reads `@vynel/sdk`'s `openapi.json` at boot, registers each `x-mcp.exposed` route (runtime OpenAPI→Zod), dispatches via `fetch` → direction ②. Advisor-vetted **runtime** (no new generator/parity, can't drift); mirrors ③'s curation. `VYNEL_API_URL` env; boots clean; verified real spec → 4 reads.
**Gate:** `pnpm install` exit 0 · `turbo typecheck` all green · `pnpm test:parity` (schema 29 · mcp · sdk) · `vitest` 513 passed / 4 skipped. **Full `pnpm test` green.**

## NEXT: providers/composer move (direction ③ — a later FEATURE pull)
The knowledge feature's backend surfaces are ALL landed (api → generators → SDK flat+namespaced typed →
MCP registry → external MCP ② → CLI → worker). The one remaining MCP piece is **direction ③** (agent-bound):
pull `packages/mcp-contract` + `apps/mcp/build-in-process-server.ts` (`createSdkMcpServer`) + the
`McpFeatureDescriptor` wrappers, and wire them into the apps/local-api turn composer (`composeSessionMcpServers`).
This needs the `packages/providers` layer, so it's the natural next FEATURE pull, not a knowledge slice.

## The 3 MCP directions (Chad's "be smarter" ask) — from studying letterman
One OpenAPI source → flat SDK + namespaced SDK + MCP registry. **① CLI** over the namespaced SDK · **② external MCP**
via `@modelcontextprotocol/sdk` stdio (tools call the API via fetch+bearer) · **③ agent-bound MCP** via `createSdkMcpServer`
(in-process; Vynel already has it). Reference = `E:\GROWTH HACKING V2\letterman` (Hono; routes + `x-sdk-name`/`x-mcp` →
generators; MCP exposes reads + safe creates, withholds destructive = matches the approval model). `E:\GROWTH HACKING
REBUILD\letterman` = Express "modules" — REJECTED (see `docs/decisions/api-routes-over-modules.md`).

## The per-module loop (`.claude/rules/build-discipline.md`)
Capture Chad's advice/gaps in `docs/module-notes/<module>.md` → git-archive package(s) from session-library →
trim/rewire un-pulled imports (rewiring `@vynel/core` shims → direct packages is the deferred "improve" polish) →
`pnpm install` + `turbo typecheck` + `vitest` GREEN → journal (`.claude/journal/`) → **prompt Chad to commit**
(conventional; **NO AI identity**).

## Gotchas
- **Flaky vitest workspace-resolution (Windows):** a stale vite/vitest transform cache can throw a bogus
  `packages/<pkg>/src/vitest.config.ts`-not-found **startup** error, intermittently, under high collection
  load. A CLEAN test file "breaking" *workspace-config resolution* is NEVER a real code bug — don't bisect for
  a culprit file (it fingers an innocent one by coincidence). Fix: clear the vite cache / re-run; foldering
  test files off a package `src/` root also helps. Ate real time on the chat pull.
- **pnpm 11.0.0 build-gate:** ONLY `allowBuilds: <dep>: true` silences `ERR_PNPM_IGNORED_BUILDS` — `false` and
  `ignoredBuiltDependencies` do NOT. Every build-script dep is `true` in `pnpm-workspace.yaml`; add new ones `true`.
  **Follow-up: bump pnpm to 11.9+** (fixes it → then unneeded native builds can be skipped).
- The api still imports `@vynel/core/{users,workspaces,errors,knowledge}` shims — faithful; rewire-to-direct is later.
- **`scripts` is a workspace entry** in `pnpm-workspace.yaml` (`- "scripts"`) — without it `@vynel/scripts` deps
  (`openapi-typescript`) don't install and `pnpm api:generate` fails `ERR_MODULE_NOT_FOUND`.
- **Improve-pass follow-ups** (deferred, from code reviews): repoint dead doc-citations in pulled comments —
  generator/SDK files **and the worker** (`env`/`factory`/`scheduler`/delegator cite `docs/foundation.md`,
  `blueprint.md §13`; factory's stale "first app to wire pino" claim + `purge-deleted-chat-sessions` examples
  reference un-pulled domains); split `generate-mcp-tools.ts` < 300 lines + drop banner dividers; strengthen the
  MCP golden test to assert tool names, not just count.
- `vitest.workspace.ts` trimmed to the node project (web re-added when `apps/web` lands).
- **Knowledge feature gaps to BUILD** (`docs/module-notes/knowledge.md`, Chad's advice, after the pipeline lands —
  it's a schema change): scope = **workspace OR global**; user **adds directories** to index; **add-to-knowledge is an
  MCP tool** ("add this to my knowledge base").

## Chad's standing directives
Skip web (he reworks it) · backend/background first · **he'll review the whole codebase after the first package fully
lands** (api + generators/mcp/cli) · he advises per module · commit = NO AI identity · prompt before commit.
