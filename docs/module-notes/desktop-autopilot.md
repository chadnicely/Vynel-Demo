# Desktop autopilot — guide verification + the arc plan

**Direction (Kafi, 2026-08-11).** Two "Jarvis" guides landed in `.tmp/jarvis-guides/`
(`JARVIS_COMPUTER_CONTROL.md`, `JARVIS_VOICE_CALLS.md`). The ask: verify them against what we
already have, then plan what to actually build — so that through desktop control a user can hand
Vynel a real task and have it run **on autopilot, like a freelancer handling it for them**.

Worktree: `.claude/worktrees/desktop-autopilot`, branch `worktree-desktop-autopilot`, based on
`c83374a` (confirmed in sync with origin, so it carries the whole desktop-control arc).

---

## Verdict on the guides: mine them, don't follow them

**Neither guide is a build spec for Vynel.** Both were written for a greenfield single-process
Jarvis app. Read against this codebase they are checklists with a handful of genuinely new items
buried in a lot of material we already ship — or already ship *better*.

More importantly: **the guides are aimed at the wrong problem.** Guide 1's capability map is
actuator-centric (mouse, keys, pixels) and we already have the actuators. What actually stands
between us and "a freelancer handled it" is not tool count — it is durability, supervision, and
verification. That is what the arcs below are about.

- Guide 1 §7's agent loop imports `query()` directly — a **hard architecture violation**
  (`CLAUDE.md`: SDK runtime only in `packages/providers/src/claude/`). Take its tool wiring, never
  its loop.
- Guide 1 §8's `canUseTool` guard is a weaker restatement of `packages/providers/src/claude/approvals/`
  + grant tiers + the plan envelope.
- Guide 2 §1's `os/voice.ts` is a **second sherpa-onnx wrapper**; `packages/voice-engine` exists
  specifically to quarantine that addon to one file — and it uses the **blocking** `generate()`
  where we already use `generateAsync`.
- Guide 2 §3's `speak` tool **already exists** (`apps/local-api/src/routes/voice/index.ts:38-46`).

Kafi already commissioned the deeper version of Guide 1's central question:
`docs/desktop-control-input-methods.md` establishes our UIA-first / SendInput-second ladder *is*
Microsoft's recommended arrangement, and that swapping libraries changes none of the real blockers
(UIPI, secure desktop, anti-cheat). Nothing in Guide 1 challenges that verdict.

### Rejected from the guides — and why (do not re-litigate)

| Guide proposal | Rejected because |
|---|---|
| `screenshot-desktop` | `node-screenshots` already does window capture **and** ships the `Monitor` API we need (verified live). Second capture stack for zero gain. |
| `node-window-manager` (read half) | `a11y/screenshot-adapter.ts` geometry + `a11y/window-state.ts` `ShowWindow` cover it. *(Its **write** half, `setBounds`, is the one additive piece — Arc 5.)* |
| `get-windows` | `a11y/window-identity.ts` already does focused-window, topmost-at-point hit test, pid→app name — as enforcement primitives. |
| `clipboardy` | nut.js ships a `clipboard` object; the guide says so itself. Widen `nut-input-loader.ts` instead. |
| `os/voice.ts` (G2 §1) | Duplicates `SherpaVoiceEngine`; its wav+`mpv` transport is strictly worse than our in-process float write. |
| `os/audioDevices.ts` / `svcl.exe` (G2 §2.5) | **Obviated — verified live.** See finding 2. |
| `tools/voiceTools.ts` (G2 §3) | `speak` already exists and is `mutatingApproved`; re-registering bypasses the generated MCP registry. |
| Touchpoint Python a11y MCP (G1 §13.4) | We already built Path B natively, including the Electron wake that recommendation exists to solve. |
| Flat `allowedTools` auto-approve list (G1 §7) | `build-claude-pre-tool-use-hook.ts:83-88` documents that bare `allowedTools` entries **shadow `canUseTool` entirely** — adopting it would silently disable our card mechanism. |
| ffmpeg / mpv anywhere | `.claude/docs/_apps/voice/structure.md:164` records the deliberate zero-ffmpeg stance. |

---

## Three findings that set the priorities

Findings 1 and 2 were verified **live on Chad's actual machine**, not read off docs.

### 1. ~~Desktop control is unreliable on the second monitor~~ — RETRACTED, it is fine

> **Corrected 2026-08-11, same day.** The claim below was **wrong**, and the
> commit that recorded it (`279c40b`) is wrong on this point. Read the correction first.
>
> **The window-relative click path is COHERENT on a fractionally-scaled monitor.** Verified against
> Win32 `GetCursorPos` on the 1080×1920 @125% panel at a negative origin: all sampled
> window-relative points land on target and inside the window, to within a pixel of rounding.
> No fix is needed and **no DPI factor belongs in that path** — adding one moves clicks *off*
> target. A bridge was implemented, tested green, and then reverted when the ground truth arrived.
>
> **What actually misled me: nut.js's `mouse.getPosition()` mis-reports on a scaled monitor.** It
> returned `(-648,-79)` for a cursor Win32 confirms was at `(-540,113)`. Every early probe used
> `getPosition` on *both* sides of the measurement, so the least-squares fit below describes the
> **reader's** error, not the writer's — and it fitted `1/scaleFactor` beautifully, which made a
> phantom bug look rigorously established. A green test suite did not save me either: the tests
> encoded the same wrong model.
>
> **The lessons, worth keeping:**
> - Never measure an actuator with its own sensor. `setPosition` cannot be judged by `getPosition`.
> - `scripts/src/desktop/probe-cursor-oracle.mjs` is the independent witness (Win32, per-monitor
>   DPI aware). Use it for any coordinate claim.
> - Nothing in production reads `getPosition`, and nothing should.
> - A clean linear fit with a physically meaningful constant is *not* proof of the mechanism.
>
> **What survives and is still worth doing:** the model has no way to know a second monitor exists
> at all — there is no `screen_info` / `list_monitors` tool, so it cannot target the other screen.
> That is the real Arc 1, and it is a capability gap, not a bug. `node-screenshots`' `Monitor` API
> (already installed) supplies the topology.

<details>
<summary>The original, incorrect finding — kept so the reasoning error stays visible</summary>

#### ~~Desktop control is unreliable on Chad's second monitor, today~~

```
monitor 1:  1920×1080  at (0,0)         scale 1.00  primary
monitor 2:  1080×1920  at (-1080,-847)  scale 1.25  rotated 270°
```

His secondary display hits **all three** of Guide §15.4's coordinate traps at once: fractional DPI
scaling, a negative origin, and rotation. The package knows:
`input/input-authorization.ts:31-37` states the window origin is in node-screenshots' physical
pixels while nut.js `setPosition` expects the OS coordinate space, and these "coincide only at 100%
display scaling" — marked *"Verified coherent at 100%."*

Compounding it: there is **no DPI-awareness declaration anywhere in the repo**, and the local-api
sidecar is spawned unmanifested from `apps/desktop/src-tauri/src/daemon.rs`.

`computeCaptureScale` (`a11y/screenshot-scale.ts:20-23`) does **not** cover this — it is an image
downscale toward 1280×800, easy to mistake for coverage.

#### Measured, not inferred (2026-08-11)

`scripts/src/desktop/probe-coordinate-fit.mjs` grid-samples a monitor: set the cursor to a known
point, read it back, least-squares fit `land = scale·ask + offset`. Results:

| Monitor | Fit | Verdict |
|---|---|---|
| 1 (scale 1.00) | `scale 1.00000, offset 0.00` on both axes, 6/6 points exact | coherent |
| 2 (scale 1.25) | `x: 0.79947·ask − 215.70` · `y: 0.79921·ask − 169.01` | **diverges by exactly 1/1.25** |

Solving the offsets against monitor 2's reported origin `(-1080,-847)` recovers a logical origin of
`(−1079.7, −846.6)` — i.e. **the origin is the same in both spaces; only the size differs.**

**Diagnosis: `node-screenshots` returns MIXED UNITS.** A monitor's `x`/`y` are virtual-desktop
(logical) coordinates, while `width`/`height` are **physical** pixels. nut.js operates entirely in
logical coordinates. At scale 1.0 the two coincide — which is precisely why the existing comment
says *"verified coherent at 100%"* and why this was never caught.

**So the fix is a conversion, not a process-wide DPI flag:**

```
logicalPoint = windowLogicalOrigin + (physicalOffsetInWindow / monitorScaleFactor)
```

`translatePoint` (`input/desktop-input.ts:69-79`) today divides only by `computeCaptureScale` (the
1280×800 downscale) and then adds the origin. It must **also** divide by the containing monitor's
`scaleFactor`, which means `resolveFrame` has to determine which monitor the window is on.

Preferred over making the process per-monitor-DPI-aware: that would change what *every* native
binding reports at once (node-screenshots, nut.js, xa11y, the PowerShell paths) with uncertain
interactions, to fix something a contained conversion fixes with data we already have.

⚠ **One thing the probe could not settle:** whether a *window's* `width`/`height` carry the same
mixed units as a monitor's. Every window open during the probe was on the primary, where the two
spaces coincide. This matters beyond accuracy — the **confinement wall**
(`input/input-authorization.ts:101-114`) compares a point against a window rect, so mixed units
there would weaken a security check, not merely misplace a click. Resolve it with a test that puts
a window on a scaled monitor as the first step of the arc.

*(It was settled: a window's bounds and its captured image agree exactly, 1.0 on both monitors, and
the whole translate path lands on target. The confinement wall is sound. The "mixed units"
diagnosis applied only to the **Monitor** API — whose size is physical while its origin is shared —
and production never reads Monitor geometry, which is why it never mattered.)*

</details>

### 2. The audio-device finding kills most of Guide 2's plumbing

Verified live: `node-cpal` exports `getDevices()` returning
`{name, deviceId, hostId, isDefaultInput, isDefaultOutput}`, and our own corrected binding already
types `createStream(deviceId, isInput, config, callback)` — **deviceId is the first argument**
(`apps/voice/src/audio/cpal.ts:36-41`).

Vynel can therefore open a virtual cable **by device id**, directly. That deletes Guide 2 §2.5
entirely: no `svcl.exe`/NirSoft, no `pactl`/`macos-audio-devices` bridge, no mutation of the user's
machine-wide defaults, no save-and-restore, no "switch before the call app launches" hazard. The
guide only needs that section because its transport (`mpv`/`ffmpeg`) addresses devices by name at
spawn time; ours addresses them by handle.

### 3. Autopilot is structurally impossible today — and this is the real plan

`desktopFeatureDescriptor` was composed at **exactly two production sites**, both global-root:
`apps/local-api/src/streams/global-root-turn.ts:188` and
`apps/local-api/src/sessions/run-global-root-turn.ts:211`.
*(Arc 2a added two more: the delegated-turn composer and the interactive spawned-session
turn — see the arc note below.)*

Consequences, each verified:

- **No delegated session has desktop tools.** `build-workspace-background-mcp.ts:47,163,168`
  compose only routing/workspace + notebook descriptors. A desktop task **cannot** run in the
  background while the user does something else — the headline framing of the ask.
- **No scheduled turn has them either**, on two independent grounds: the schedule composer attaches
  none (`build-schedule-fire-deps.ts:40`), and the LLM schedule path is workspace-scoped and throws
  when `workspaceId` is null (`fire-schedule.ts:106-110`) while desktop lives on the global root.
- **The root lock serializes everything for the turn's whole life.**
  `run-global-root-turn-core.ts:160` wraps the entire turn in `runUnderRootTurnLock`, a promise-chain
  with **no timeout, no depth limit, no abandon path** (`root-turn-lock.ts:17-32`). A 20-minute
  desktop turn queues every other global-root turn behind it — the Telegram "how's it going?", the
  voice turn, the delegation report-delivery — and the channel poller runs at ~1s, so a backlog
  builds and fires all at once when it ends.
- **Nothing bounds a turn.** No `maxTurns`, no wall-clock, no cost ceiling
  (`build-claude-sdk-options.ts:86-177`). A model looping on a failing click runs until a human
  presses Stop. Enabling for long work; dangerous without a watchdog.
- **Nothing verifies effect.** `act-on-app-tool.ts:102` returns `Done: ${action} on ${selector}` —
  that is **dispatch**, not effect. `DesktopPlan` carries no done-criteria
  (`desktop-plan-envelope.ts:31-38`). Whether the real task succeeded is whatever the model asserts.
- **Nothing is durable.** The plan envelope is explicitly turn-scoped
  (`desktop-plan-envelope.ts:1-5`: *"no schema, no persistence"*); a failing turn ends
  non-recoverable (`run-claude-chat-session.ts:308`) with no requeue. And the existing delegation
  retry replays the **original task text** (`classify-turn-failure.ts:20`) — on a stateful desktop,
  replaying "book the flight" after a partial run is actively dangerous.

**Remote driving does work today** (a Telegram message reaches `runGlobalRootTurn`, which attaches
desktop) — but you can start a task remotely and then neither **monitor** nor **stop** it: tool
events are deliberately not translated to channels (`translate-chat-event-to-channel.ts:95-99`, and
that translator is unwired), and there is no stop path in `channels/src/inbound`. The entire remote
progress story is a "typing…" indicator refreshed every 4s, then one message up to 20 minutes later.

**The product shape this implies — worth stating plainly, because it is not an implementation
detail.** `deriveDesktopPlanConsent` sends any unrecognised mode to `display-only`
(`desktop-plan-consent.ts:12-26`), and a `display-only` envelope authorizes nothing
(`desktop-plan-envelope.ts:73`). The rule behind it — *a background turn can never self-grant* — is
correct and must survive every arc below. So the honest autopilot flow is: **the user grants the
apps once, and from then on the task runs unattended.** An unattended attempt on a *new* app parks
a card. That is the reachable product, and the UX should teach it rather than fight it.

---

## What we already have (so the plan doesn't rebuild it)

11 MCP tools on the in-process `desktop` server — six always-on
(`list_desktop_notifications` · `list_open_apps` · `list_installed_apps` · `snapshot_app` ·
`screenshot_app` · `request_desktop_access`) and five behind `enableActions`
(`propose_desktop_plan` · `act_on_app` · `act_on_desktop` · `launch_app` · `set_window_state`).

Safety, all shipped: per-app grant tiers (`read`⊂`click`⊂`full`, exact-key) · the turn-scoped plan
envelope (acts refuse until armed, **every mode**) · mode→consent derivation with a `display-only`
floor so a background turn can never self-grant · password hard wall · coordinate confinement ·
z-order hit-test identity · focus-directed authorization · atomic batch validation · timeouts on
every native op · persisted tool-call audit rows · `interrupt(sessionId)` · the always-on overlay,
including for subagent-driven steps.

Against Guide 1's §3 capability map we are **ahead** on the accessibility tree, app launch, window
state, batching, and every safety layer.

---

## The arcs

Ordered by what actually blocks the autopilot story. Each lands green and reviewed on its own.
`.claude/docs/desktop-control/structure.md` is already self-flagged partially stale, so the doc
refresh rides **in** the arc that changes the tool table, never deferred.

### Arc 1 — The model cannot see past the primary monitor (revised)

*Originally "coordinate truth", on the assumption that scaled-monitor clicks were broken. They are
not (see the retraction in finding 1). What remains is a genuine capability gap.*

Nothing in the tool surface reports that a second monitor exists. `list_open_apps` gives names,
`screenshot_app` captures one window — there is **no `screen_info` / `list_monitors`**, no display
count, no resolution, no topology. So the model cannot reason about "the other screen" at all, and
an absolute-coordinate action on a monitor at a negative origin is a guess.

- Expose monitor topology from the **already-installed** `node-screenshots` `Monitor` API
  (`Monitor.all()` → id, x, y, width, height, `scaleFactor`, `isPrimary`, `rotation`). No new
  dependency; `Window.currentMonitor()` also exists, so a window can name its display.
- **Report `scaleFactor` as information, not as a correction.** It tells the model a display is
  scaled; it must NOT be applied to coordinates (that was the retracted mistake).
- Note the mixed units in the Monitor API itself — origin shared, size physical — so the next
  reader doesn't rediscover it the hard way.
- Negative coordinates already validate correctly on the act path (`z.number()`, no `min(0)` bug) — keep it.
- Keep `scripts/src/desktop/probe-cursor-oracle.mjs` as the standing coordinate oracle.

**Live-verifiable, and already partly verified** — the probes exercise the real desktop.

### Arc 2 — The autopilot spine

The arc that makes "a freelancer handled it" real. Three coupled pieces:

> **Kafi's scope call (2026-08-11):** *"our global can spawn session it needs it can spawn session
> and assign it task so not a big deal — we just need to make everything available."* Correct, and
> it shrinks this arc considerably. The spawn/delegate machinery is already built and already
> escapes the root lock; the arc is **availability, not new infrastructure.** 2c is therefore NOT
> taken (see below), and 2b is deferred to a separate decision after this runs live.

**2a. Make desktop available to spawned sessions.** The only thing stopping a spawned session from
driving the desktop is one composition list: `build-workspace-background-mcp.ts:47,163,168` compose
`[vynelRoutingDescriptor, notebookFeatureDescriptor]` (and siblings) — `desktopFeatureDescriptor`
is simply absent. Adding it needs the descriptor's context requirements threaded through
(`desktopReader` + `enableDesktopActions`, today wired only at `app.ts:212-217` for the two
global-root paths) and its own consent derivation.

The `display-only` floor stated in finding 3 must survive intact: a spawned/unattended desktop task
authorizes nothing beyond **standing grants**, and parks a card for a new app. That is the rule
that keeps "a background turn can never self-grant" true, and it is what makes this arc safe to be
as small as it is.

**2b. A durable task record** — so "the turn ended" becomes "the task is resumable", the
prerequisite for honest retry. **DEFERRED by Kafi's scope call** — revisit once 2a is running live
and we can see how often a real task actually dies mid-way. Note that delegation jobs already carry
`attemptCount`/`nextAttemptAt`/`errorCode` and a boot-recovery sweep, so a spawned desktop task
inherits *some* durability for free; what it lacks is a step cursor and desktop-aware retry
semantics. Recorded here so the tension below isn't rediscovered from scratch:

> **The tension to settle first, not discover mid-arc.** The plan envelope is non-durable *by
> design*: `desktop-plan-envelope.ts:1-5` — "no schema, no persistence, nothing to revoke" — and
> that is exactly what makes one-time plan consent safe, because the approval dies with the turn
> and cannot be replayed later. Persisting the approved plan means **persisting a consent
> artifact**. So the record deliberately stores **goal + step cursor + observed state and NOT the
> consent**: authority is re-derived every turn from standing grants or a fresh card. Anything
> else is a change to the consent model and needs its own decision.
>
> This needs a table. Per house rule: **drizzle generate only, never hand-write** —
> `pnpm --filter @vynel/db exec drizzle-kit generate`. A schema change is planned deliberately,
> never slipped in on red.

**2a SHIPPED (2026-08-11).** Composer change + boot wiring + the interactive-parity
fix + overlay visibility + Stop targeting. Reviewed by `code-reviewer`; three
must-fixes found and two fixed outright:

- **Server-strip bug (fixed).** `streams/session-turn.ts` — the *interactive* turn into a
  spawned session — didn't attach desktop, so typing into a session that had just run a
  desktop task resumed the SDK session with the server GONE. Stripping is the
  "MCP server disconnected" class the one-toolset rule exists to prevent. Desktop is now
  merged in there too (the pre-existing vynel plain-vs-interactive delta deliberately left
  alone — it stays within one server name, so it never strips).
- **Dark-overlay bug (fixed).** The delegation tick announced only "this job is busy" and
  published no per-tool steps, so a spawned session would have driven the mouse behind a
  DARK overlay — the same hole the subagent mapping closed. The turn observer now publishes
  turn activity steps **unconditionally** (not gated on anyone watching). This also closes
  the recorded "delegated turns publish NO narration steps" gap **for task jobs**;
  `run-agent-run-job` and the workspace branch of `run-report-delivery-tick` still narrate
  blank.
- **Stop targeted the wrong session (fixed).** The overlay's Stop called
  `root.interruptTurn()`, which resolves the *root* primary — so for a delegated desktop
  turn it was a no-op on the actual driver, and would kill an unrelated root turn while
  reporting success. The fold now learns `origin`/`partialSessionId` from `turn-started`
  and Stop routes to `root.stopDelegation` for delegated turns. When origin is unknown
  (overlay attached mid-turn) the button is **disabled** rather than guessing.

> ### ⚠ OPEN DECISION for Kafi — a spawned turn CAN still self-grant under auto/bypass
>
> The claim "a background turn can never self-grant" does **not** hold for a delegated
> turn, and I did not silently change the security model to make it hold.
>
> The path: the dispatching root turn's permission mode is stamped on the job row and the
> delegated turn runs under it. In the user's own `auto`/`bypass` the approval floor stands
> down (`build-claude-pre-tool-use-hook.ts` — `floorStandsDown`), so
> `request_desktop_access` runs **uncarded** and mints a standing grant with nobody
> watching; the plan-gated authorizer then passes on that standing grant.
>
> Channel/voice turns do **not** have this hole — they default to
> `bypass-with-behavior-gate`, where the floor holds.
>
> **The question is genuinely a product one:** does the user's auto/bypass pick transitively
> consent to desktop reach in work they delegated during that turn? Both answers defensible.
> - *Yes* → nothing to do; correct the docs to say so plainly.
> - *No* → needs a way to force a card for ONE tool even in auto/bypass, which is a
>   provider-level change (there is no such seam today).
>
> What I did instead: made the code comment and the test name state only what is actually
> guaranteed — that an armed **plan** is not itself an authority path.

**2c. Rework the root lock — NOT TAKEN.** Once long desktop work runs in a spawned session it
already escapes the lock (the global-root core is the **sole** acquirer of `runUnderRootTurnLock` —
verified). Reworking `root-turn-lock.ts:17-32` would touch the serialization guarantee for web,
voice, channel and report-delivery turns simultaneously, for a problem 2a dissolves.

The residual, recorded honestly: a desktop task the user starts *and keeps* on the global root
(rather than handing to a spawned session) still blocks their other turns for its duration. The
mitigation is behavioural — the root should hand desktop work off rather than run it inline — which
makes it an instruction/routing concern, not a locking one.

### Arc 3 — Supervision: stop it, watch it, bound it

- **Stop that reaches the handler.** `runActionBatch` (`act-batch.ts:39-61`) is a plain loop with no
  predicate and no `AbortSignal` anywhere in the package; with per-step timeouts of 15–25s, a Stop
  can be followed by **up to ~5 minutes of continued clicking**. Already recorded as open in
  `desktop-control-plan-approval.md:92-94`.
- **Remote monitoring + remote stop** for channel-driven tasks.
- **A turn budget / no-progress watchdog** that ends cleanly *and records where it stopped* (which
  requires Arc 2's durable record to be worth anything).
- **Approval stalls**: unattended, an unanswered card burns ~10 minutes
  (`recover-stale-pending-approvals.ts:68`) while holding the root lock; group-origin cards can
  never be answered (`route-as-chat-turn.ts:107-113`); `ask_user` has no timeout at all
  (`ask-user-tool.ts:5-6`). Needs a per-task approval budget and an escalation path.

### Arc 4 — Did it actually work?

- **Post-action verification.** Follow the two precedents that already do this right: `launch_app`
  waits for a real window (`apps/launch-app.ts:102`), `set_window_state` reports a **verified** end
  state. Generalise rather than invent.
- **Done-criteria on a plan step**, so "sent the message" is checkable rather than asserted.
- **`wait_for({app, until, timeoutMs})`** — there is no model-callable observation-until-condition
  primitive, so the model burns a screenshot round-trip per poll.
- **Recovery from the unexpected** — popup, login wall, crashed app. Today the turn just ends.

### Arc 5 — Cheap capability fills

Mostly one file: widening `input/nut-input-loader.ts:22-34` unlocks `mouse_move`, `mouse_position`,
`mouse_button` (press/hold/release) and Guide §15.3's stepped `humanDrag` — **no new dependency**.
Our drag today is the naive single-jump `mouse.drag([from,to])` (`desktop-input.ts:228-232`) the
guide correctly says fails.

Also: **clipboard** (nut.js already ships it; only the loader interface blocks it) — the single
highest-value item here, since "copy from app A, paste into app B" is a core freelancer primitive
far more reliable than retyping through synthetic keystrokes. Plus whole-screen capture (only
per-window exists) and `set_window_bounds` (the one place `node-window-manager` is additive).

The ≤300-line rule forces **new files, not extensions**: `act-on-desktop-tool.ts` is at 264,
`desktop-input.ts` at 239.

### Arc 6 — Decide explicitly, in or out

Each needs a new dependency, so each is a deliberate call: OCR (`tesseract.js`) · volume
(`loudness`) · CPU/mem/battery + process list (`systeminformation`) · sending a desktop notification
(`node-notifier`) · open arbitrary file/URL (`open`).

Also here: **the act flag becomes a real setting.** `VYNEL_DESKTOP_ACT_ENABLED` is env-only and
default-off; if autopilot is the headline this must be a user-facing toggle carrying the
isolated-machine acknowledgment. Flagged in `desktop-control-plan-approval.md:216`; autopilot moves
it onto the critical path.

### Arc 7 — Voice in calls (last, and gated on a Chad decision)

Sequenced last: depends on nothing above, and the desktop story is the headline ask. Given finding 2,
the genuinely new work is:

1. Expose `getHosts()`/`getDevices()` on `CpalNative` (`apps/voice/src/audio/cpal.ts:29-44`) + a
   name→deviceId resolver.
2. Make `createAudioShell` device-parameterised instead of hardcoding the default getters
   (`audio-shell.ts:32-35`); new env vars in `apps/voice/src/env.ts` — the sanctioned `process.env` site.
3. A **second capture stream** for the call's audio, with its own VAD instance
   (`audio-shell.ts:96` opens exactly one input).
4. **Output fan-out** — speaking into the cable while the user monitors locally is a two-sink write
   that does not exist (`audio-shell.ts:44` opens exactly one output).
5. **Duplex turn-taking** — `voice-session-driver.ts:101` drops *all* inbound audio while busy. One
   change serves two features: call duplex **and** the missing human barge-in
   (`voice-session-driver.ts:18-19`: *"v1 has no user barge-in"*).
6. **A call turn policy** — wake-gating assumes one user addressing one assistant; in a multi-party
   call "every utterance after wake is a command" fires on cross-talk. A design decision, not a file edit.
7. Deep-link joining is **structurally blocked**, not merely absent: `launch_app` takes an
   installed-app name, prepends `shell:AppsFolder\`, and its validator rejects `&` — so
   `zoommtg://…?confno=…&pwd=…` fails outright. Needs a separate scheme-allowlisted URI primitive.

**⚠ Two decisions for Chad before any of this is built** — not defaults to assume:

- Capturing other participants' audio for STT triggers **call-recording consent law** in many
  jurisdictions. Nothing today models "we are in a call", so there is no place to hang a disclosure.
- "Vynel speaks as the user in meetings" is a **materially different risk class** from "Vynel drives
  the user's own desktop." A product call, not an engineering one.

---

## Deliberately NOT in this plan

- Any dependency from the rejected table.
- The UIAccess manifest for driving elevated windows — `docs/desktop-control-input-methods.md`
  already ruled *revisit after code signing*; unchanged.
- Evading anti-cheat or the secure desktop. Hard boundaries by design.
- A Bash pattern denylist (G1 §8.1) — `Bash` is already carded; a real gap, but it belongs to the
  approvals module, not here.
