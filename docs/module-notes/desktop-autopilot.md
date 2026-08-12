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

## WHAT'S LEFT — the live list (2026-08-11, after Kafi's smoke test)

Everything below the arcs is history; this is the outstanding work. Kafi's smoke test passed on the
overlay lifecycle, Stop routing, a second task starting clean, and `wait_for`. **Voice (Arc 7) is
owned by a separate session and is NOT tracked here any more.**

### DEFERRED by Kafi, 2026-08-12 — waiting on surfaces that do not exist yet

Not dropped; blocked on a decision that isn't ours to make yet. Kafi: *"we will ultimately have
mobile app later and the enabled env will sit in app setting so not our current deal."*

1. **Remote monitoring + remote stop.** A Telegram message can start a desktop task, but there is no
   way to watch or stop it — the remote story is a "typing…" indicator refreshed every 4s, then one
   message up to 20 minutes later. **Deferred:** the mobile app will define this surface, and
   building it against Telegram first would be building it twice.
   (`translate-chat-event-to-channel.ts` skips tool events and is unwired; `channels/src/inbound`
   has no stop path.)
2. **A server-side interrupt for the spawned-session surface.** No stop route at all, which is why
   the overlay's Stop honestly disables there. Shape: `chat.interruptSession` keyed by `sessionId`.
   **Deferred with 1** — it is the primitive 1 needs, and lands when 1 does.
3. **The act flag as a real setting.** `VYNEL_DESKTOP_ACT_ENABLED` is env-only and default-off.
   **Deferred:** it becomes an app-settings toggle, so it waits for that surface.

### NEXT — decided 2026-08-12, in order

- **A. Retire the per-app grant model.** Kafi's call: no "may I use this app?" cards — they ask a
  second time for consent the *plan* already carries, in a vocabulary a non-technical user cannot
  evaluate (today's cards said "Docker Desktop Launcher" and "Application Frame Host"). Replaced
  later by a **desktop access LOG** showing what Claude did. Identity was done first deliberately,
  so the log and the plan envelope name real apps. ⚠ Known cost, decided with eyes open: the
  standing grant is currently the only check the model cannot grant itself
  (`propose_desktop_plan` cards in ask mode ONLY, so an unattended turn arms its own envelope —
  see `unattendedRefusalError`). Attended turns are unaffected; **unattended desktop work loses its
  independent gate** and the log is after-the-fact. Worth Chad seeing.
  **The shape, in three green phases** (~50 files across desktop-control, local-api, providers, ui,
  local-web — too big for one commit, and a HALF-removed security layer is worse than none):
  - **A1 — the semantics.** The plan envelope becomes the sole authority.
    `makePlanGatedAuthorizer(envelope, standing)` currently falls through to the standing grant on a
    plan miss, and — the trap — **returns (ALLOWS) when no standing authorizer is passed**, which is
    how test harnesses build ungated tools. Dropping the second argument without flipping that
    default would make every act permissive. So A1 inverts it: a plan miss DENIES, with the
    "propose an updated plan" recovery. This is the only phase that changes behaviour.
  - **A1 ✅ DONE 2026-08-12** (`afd208f`). Scoped to ACTING. Gate green.
  - **A2 / A3 — 🔴 BLOCKED, and it needs one decision from Kafi.** ⚠ **Do not start these without
    answering the question below**, or reading breaks completely.

    **The question: should READING the desktop still need consent?**

    The read tools (`snapshot_app`, `screenshot_app`, `wait_for`) do NOT go through the plan — a
    read needs no plan, by design. Their only gate is the per-app grant. So:
    - Delete `request_desktop_access` (A2) while reads still require a grant ⇒ **no way to create
      one ⇒ reading becomes impossible.** The two halves cannot land separately.
    - Delete the read gate too ⇒ any turn can screenshot any window, with no consent anywhere.
      That is a privacy LOOSENING, and the opposite direction from A1, which tightened acting.

    A1 was deliberately scoped to acting because it is strictly *more* restrictive and needed no
    ruling. This one does. Three coherent answers:
    1. **Reads free.** Simplest, matches "as per user ask it can open any app", and the access LOG
       becomes the accountability. Accepts that a background turn can screenshot anything.
    2. **Reads ride the plan.** A read of an app the plan does not name is refused. Keeps one
       consent model, but changes today's "a read needs no plan" contract and would make the
       observe-then-plan flow awkward — you often read to find out what to plan.
    3. **Reads free only on an attended turn** (consent ≠ `display-only`), mirroring the clipboard
       rule in `unattendedRefusalError`. Probably the closest to the existing security posture.

    My read: **3**, because it keeps the property the whole envelope exists to protect — a
    background turn can never self-grant — without making the ordinary attended flow clumsy. But it
    is a product/privacy call, not an engineering one, and worth Chad seeing alongside A.
  Tiers SURVIVE all three: they are how a plan states intent (`apps: [{app, tier}]`), and the
  `read ⊂ click ⊂ full` ladder still gates what an armed plan permits.

- **B. The shadowed-Store-app error.** ✅ **DONE 2026-08-12** (`3f78992`). Both failure paths now
  name the cause and point at `screenshot_app`. The worse of the two was the *confidently wrong*
  one: the shared host exposes a single `MainWindowTitle`, so the shadowed sibling fell through to
  the tray branch and a visible window was declared "minimized to the system tray". When a second packaged app holds the accessibility
  connection, `snapshot_app` fails with `No element matched selector: application[pid=6280]` —
  opaque, so the model cannot fall back. It should name the cause and point at `screenshot_app`,
  which works fine for these windows. Small diff, real value.

### Real gaps found by using it

4. ~~**An app minimized to the SYSTEM TRAY cannot be reached — and we describe it wrongly.**~~
   **RESOLVED 2026-08-12.** Kafi hit this with Docker Desktop. The *detection* half was real and is
   fixed: a tray app is hidden, not minimized — every Docker process reports `MainWindowHandle = 0`,
   so `findWindowedPidByName` filters it out (`MainWindowHandle -ne 0`) and the user was told "no
   matching app is open", which is false. `isProcessRunningByName` now tells the two apart.

   The *recovery* half was misdiagnosed, and how is worth remembering. I measured `launch_app`
   against a tray-hidden Docker, saw nothing appear in 21s, and concluded Windows had no reliable
   way back — writing that into the tool description, the shared `trayHiddenMessage`, and the system
   prompt. **The root cause was ours.** `launch-app.ts` built its PowerShell as
   `-Command '… + $args[0]' -Args <appId>`, but `-Args` is only honoured by `-File`; under
   `-Command` it is silently ignored, `$args` stays empty, and the path collapses to bare
   `shell:AppsFolder\` — a real folder, so `Start-Process` **succeeded** and opened the Applications
   window. Every launch reported success and nothing ever started. Kafi found it by hand: *"if you
   visit this you can see all apps and if you click on app icon it open if minimized."*

   With the id actually passed, Docker came back from the tray in **~1 second**. The AppID rides an
   env var now (same no-interpolation guarantee, no `-Args` trapdoor), and
   `buildLaunchInvocation`'s tests assert the **resolved** `-FilePath`, since asserting the argument
   array would have passed the entire time. All three tray messages now name `launch_app` as the
   recovery that works.

   *(The unexplored option stays unexplored, and is no longer needed: the notification area is
   UIA-accessible, so a tray icon could be invoked directly. More fragile and app-specific.)*

   **The lesson:** never let a tool's silence become a claim about the platform. I shipped
   "Windows can't do this" three times over, and it was a missing argument.

   **Two follow-ups, found by smoke-testing the fix (Kafi, same day).** Tray recovery changed the
   shape of `launch_app`: it is now routinely called on apps that ARE running, and both bugs were
   dormant until that became true.
   - *A second activation is not free.* Docker answers one with an **"acquiring launcher lock"**
     error dialog. `launchApp` now looks at the window roster BEFORE starting anything and returns
     `already-open` — a tray app has no window, so recovery still launches, which is exactly the
     line that separates the two cases.
   - *The appeared-window match was unranked.* `find()` on a loose substring took whichever window
     was enumerated first, so the leftover **"Docker Desktop Launcher"** dialog was reported AS
     Docker and the model spent the turn screenshotting and requesting access to an error box.
     `selectAppearedWindow` now ranks: exact name → the window reporting a *plainer* name
     ("Firefox" for "Firefox Developer Edition") → a name that *extends* the request, shortest
     first. That third tier is the suspicious direction — it is what "<App> Launcher", "Helper" and
     "Setup" all look like. Same lesson `selectWindowedPid` already learned for Electron helpers;
     this function never got it.

### IN PROGRESS — the PACKAGED-APP (UWP) class

A UWP window belongs to the shared **`ApplicationFrameHost`** process, not to the app. Measured live
2026-08-12 with Calculator and Settings open together:

```
node-screenshots:  "Application Frame Host" | "Settings"   | pid 8828
                   "Application Frame Host" | "Calculator" | pid 8828
xa11y App.list():  Settings#8828            <- Calculator absent entirely
findAppNameByPid(8828) -> "Application Frame Host"   (for BOTH)
resolveAppIdentity(8828, "Calculator") -> "Application Frame Host"
```

**One root cause — a pid is not a unique app identity for this class — and three defects:**

1. **Identity collision. This is a security widening, not a naming wart.** Both apps key on
   `"Application Frame Host"`, so a grant the user approves for *Calculator* equally authorizes
   Settings, Store, Photos and Mail. The per-app grant envelope's whole promise is that consent is
   per app; here one consent silently covers a whole class. This is the half that matters.
2. **Reachability.** xa11y's `App.list()` is keyed per pid, so with two packaged apps open only one
   is reachable — `App.find("Calculator")` fails outright while Settings holds the host.
3. **`launch_app` under-reports.** `listWindowAppNames()` yields only `"Application Frame Host"`, so
   a launch that plainly worked comes back `started-no-window`. The window also opens *behind*
   everything (`visible=True`, `iconic=False`, `isForeground=False`) — Windows' foreground lock, a
   background process cannot raise a window.

**FIXED 2026-08-12 (defects 1 and 3).** The rule: a window owned by a known host process takes its
identity from the window **title**, and *a host process name is never itself a valid identity*. That
second clause is what closes the hole — nothing can resolve to `"Application Frame Host"` any more,
so the stale grant row keyed on it is unreachable whatever else changes.

`window-host-processes.ts` is the one home for the rule. Its own leaf with no imports, because BOTH
identity paths need it and they already point at each other (`window-identity.ts` reaches the window
source through `screenshot-adapter.ts`). The sweep found that second path: `readWindow` in the
screenshot adapter builds the `appName` that `findAppWindowBounds` hands the coordinate input path
to enforce against — so it had the same widening, and fixing only `window-identity.ts` would have
left it open.

Where it fails closed rather than guessing:
- A hosted window with **no title** is unnameable — null, never the host name.
- `findAppNameByPid` on a hosted pid owning **more than one** window is genuinely ambiguous
  (Calculator and Settings are both pid 8828); it answers null rather than naming the wrong app.
- `set_window_bounds` now passes `''` as `resolveAppIdentity`'s fallback instead of the model's
  query. The comment there already said "never the fuzzy query" while passing exactly that — with
  one pid behind two apps, "move Calculator" would have named a Settings window Calculator.
  `resolveAppIdentity`'s contract is now written down: **the fallback must be OBSERVED, never
  REQUESTED.**

Verified live with both apps open on the shared pid: the roster reports `["Settings","Calculator"]`
and no longer contains `"Application Frame Host"`; `findAppNameByPid(8828)` is null;
`findAppWindowBounds("Calculator")` reports `"Calculator"`; `launch_app` on an open Calculator
returns `already-open` with zero launches. Non-packaged apps are unchanged (`"Discord"` →
`"Discord"`).

**Still open — defect 2, reachability.** Not ours: `App.byPid(8828)` returns a tree rooted at ONE
window (measured: `window "Settings"`, with Calculator absent), and `App.find("Calculator")` throws
while Settings holds the entry. That is inside the xa11y binding. **Documented limitation: only one
packaged app is readable at a time.**

**Note for the grant removal.** A stale `application frame host : read` row exists in the dev
database. It is inert after this change (nothing resolves to that name), and it is left in place
rather than silently deleted — it is a record of consent Chad/Kafi gave, and it disappears with the
grant model itself.
5. ~~**Windows cannot be moved or resized.**~~ **DONE.** `set_window_bounds` shipped (SetWindowPos
   under `SetProcessDpiAwareness(2)`, reporting the VERIFIED applied rect). Kafi confirmed live:
   *"Moving is worked."* The entry stayed stale on this list for a day — worth noticing that a
   living list needs closing out, not just appending to.

### PARKED — Docker Desktop specifically

Tray restore works for **qBittorrent, IDM and Telegram** (Kafi, live 2026-08-12). Docker alone
fails, with its OWN error: `acquiring launcher lock: open : The system cannot find the file
specified`. Its processes had been up ~10h with no window, and the identical command restored it
three times earlier the same morning — so this is Docker's internal lock state, not the mechanism.
**Parked by Kafi.** The next real datapoint is a restarted, healthy Docker: if activation fails
*then*, it is a reproducible gap worth building an AppsFolder-click fallback for. Until then that
fallback would be built on an unverified premise — a real click and `Start-Process
shell:AppsFolder\<id>` may well be the same ShellExecute path, and we have no case that
distinguishes them.

### Quieter, but real

6. **Durable task record (2b).** Deferred by Kafi's scope call; worth revisiting now that spawned
   desktop work actually runs. A task that dies mid-way has nothing to resume from. Note spawned
   tasks inherit *some* durability free (delegation jobs carry attempt counts + a boot sweep); what
   is missing is a step cursor and desktop-aware retry semantics.
7. **Post-action verification (Arc 4's other half).** `wait_for` landed; generalising "did it
   actually work?" from the `launch_app` / `set_window_state` precedents did not. Success is still
   largely what the model asserts.
8. **Approval-stall budget.** Unattended, an unanswered card burns ~10 minutes *while holding the
   per-user root lock*, so a "are you stuck?" message cannot even be processed. A group-origin card
   can never be answered at all.
9. **The two 10-minute budgets are identical.** `DELEGATION_RUN_BUDGET_MS` measures from *claim*,
   the new task watchdog from *first arm* — so on a spawned session the delegation budget always
   bites first and the watchdog only really covers attended turns. They probably should not match.
10. **Cheap fills still open:** `mouse_position`, `mouse_button` (press/hold/release), whole-screen
    capture. One file each; the nut loader widening unlocks most of them.

### Decisions, not work

11. **Arc 6 in/out calls** — each needs a new dependency: OCR (`tesseract.js`) · volume
    (`loudness`) · CPU/mem/battery + process list (`systeminformation`) · sending a desktop
    notification (`node-notifier`) · opening an arbitrary file/URL (`open`).
12. **Deep-link joining** (`zoommtg://`, `msteams:`) — needs a scheme-allowlisted URI primitive
    beside `launch-app.ts`; higher-risk surface than anything above.

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

> ### ✅ SETTLED (Kafi, 2026-08-11): in auto/bypass, no card at all
>
> The question was whether the user's auto/bypass pick transitively consents to desktop
> reach in work they delegated during that turn. **It does.** Those modes ARE the standing
> consent, and it carries into delegated work.
>
> That was already the behaviour — the approval floor stands down in auto/bypass
> (`build-claude-pre-tool-use-hook.ts`), so `request_desktop_access` ran uncarded. What was
> *incoherent* was the envelope: a delegated turn got `display-only`, so instead of its
> approved plan authorizing its apps **for that turn**, it had to mint **permanent**
> `desktop_app_grants` rows to act — silently growing the user's standing-access list as a
> side effect of one task. That contradicted the one-time-grant intent from Arc 1.
>
> **Now:** the delegated composer derives plan consent from the turn's own mode, through the
> same one-home `deriveDesktopPlanConsent` the global-root sites use. Envelope and floor can
> no longer disagree. `auto`/`bypass` → the plan authorizes for the turn, nothing persisted.
> `ask` → the plan cards once. The interactive spawned-session turn derives from its own
> mode too — the user is literally typing into it.
>
> **The floor survives where it was meant to.** A channel-origin or pre-mode job carries no
> mode and the runner defaults it to `bypass-with-behavior-gate`, which still maps to
> `display-only`: the plan narrates, authority comes only from standing grants, and a new
> app parks a card. "A background turn can never self-grant" holds for genuinely unattended
> turns — which is the case that rule was written for.
>
> The clipboard is stricter still and deliberately so: being app-less it has no
> standing-grant door, so it refuses under `display-only` entirely rather than falling back
> to one (see Arc 5).

**2c. Rework the root lock — NOT TAKEN.** Once long desktop work runs in a spawned session it
already escapes the lock (the global-root core is the **sole** acquirer of `runUnderRootTurnLock` —
verified). Reworking `root-turn-lock.ts:17-32` would touch the serialization guarantee for web,
voice, channel and report-delivery turns simultaneously, for a problem 2a dissolves.

The residual, recorded honestly: a desktop task the user starts *and keeps* on the global root
(rather than handing to a spawned session) still blocks their other turns for its duration. The
mitigation is behavioural — the root should hand desktop work off rather than run it inline — which
makes it an instruction/routing concern, not a locking one.

### Arc 3 — the overlay + the watchdog (2026-08-11, from Kafi's live testing)

**The overlay followed the wrong turn.** Kafi hit three symptoms — overlay Stop dead, chat Stop
left the overlay up, a new desktop task rendered under the OLD task's narration. One cause: the
fold set `trackedTurn` from `turn-started`, which fires for EVERY turn including the many that
never touch the desktop, so it latched onto the first turn it ever saw. `turn-started` now only
populates a bounded lookup; the DESKTOP STEP decides what is followed, and a step *or an approval
bell* for a new turn starts clean.

> **Correction to the commit message of `d1cea50`.** It claimed the fix is "what makes the chat's
> Stop clear the overlay". That holds only for **root-driven** desktop work. For a *delegated*
> turn, `root.interruptTurn()` cannot end it by design, so the overlay legitimately stays up — the
> old fold already retargeted on each desktop step, so a missed `turn-ended` was never the whole
> story for symptom A. Of the three regression tests, two genuinely fail without the fix; the
> turn-ended one passes on the old code too.

**Stop now refuses rather than hitting the wrong session.** Review traced a real misroute: the UI's
spawned-session surface announces `origin: 'web'` exactly like a root turn, so the overlay fired
`root.interruptTurn()` — which resolves the **global** primary and stops a *different* session
while the mouse keeps moving, returning `{interrupted: true}` either way. `primarySessionId` is now
carried, and Stop is offered only for the two routes that actually stop the turn in front of you
(delegated → `stopDelegation`; global root → `interruptTurn`). Anything else disables the button and
says to stop it from its own conversation.

> **Still unrouted, recorded not fixed:** the spawned-session surface has no server-side interrupt
> (`use-session-turn.ts` — "client-side stop only"). The honest fix is a route keyed by `sessionId`,
> shaped like `chat.interruptSession`. Also: a global-root *report-delivery* turn announces
> `origin: 'delegation'` with the CHILD's `partialSessionId`, so Stop there would stop the child's
> job rather than the turn doing the work — narrow, pre-existing, and left alone deliberately.

**The watchdog.** Nothing bounded a turn: no step cap, no wall clock, no cost ceiling. Now the plan
envelope carries a 10-minute task budget, checked in the shared `planRequiredError` pre-flight that
all five acting paths already go through (including the clipboard's `unattendedRefusalError`). The
clock starts at the FIRST arming and does **not** reset on a re-plan — otherwise a stuck model
re-proposes its way around the budget forever, which is the loop it exists to end.

> **Two honest limits.** Once spent it is spent for the whole turn — no operator override, and the
> user watching the overlay cannot grant more time; recovery is to end the turn. And on a *spawned
> session* the delegation runner's own `DELEGATION_RUN_BUDGET_MS` is also 10 minutes measured from
> **claim**, i.e. strictly earlier — so there the existing budget always bites first and this
> watchdog's real value is the attended root/web/channel turn. The two numbers probably should not
> match; left as-is pending a deliberate call.

**Raisable timeouts.** A slow app and a dead control failed identically, and the error asserted the
second — so a merely-slow app (big window, heavy page, cold start) looked broken and the model went
hunting for another element. `snapshot_app` takes an optional `timeoutMs` and the timeout error
names that retry first. Deliberately NOT offered on the held-reader path `wait_for` uses: it cannot
pass a read timeout through, so the hint would send the model to bump `wait_for`'s own `timeoutMs` —
a different knob, clamped lower than the number it was promised.

### Arc 3 (earlier) — Supervision — PARTIALLY SHIPPED

**The batch wall-clock bound (SHIPPED).** A running batch is un-interruptible — Stop aborts the
model loop, not an in-flight tool handler — so at 20 actions × a 15 s per-action bound that was up
to five minutes of clicking *after* the user asked it to stop. `runActionBatch` now carries a 45 s
wall-clock budget, checked **between** steps (never during one: abandoning a half-typed field is
worse than finishing the keystroke). A deadline reads differently from a failure in the report —
saying "stopped at action N" would send the model hunting for a fault in a step that worked.

> **Measured, and it killed the obvious design.** The natural fix is to check the MCP request's
> `AbortSignal` between steps. The handler *does* receive `extra.signal` — but cancelling the call
> rejects only the **caller's** promise while the server-side handler runs to completion and never
> sees `aborted` (probed against the shipped SDK, 2026-08-11). A predicate on it would have been
> decoration. Time is the honest bound: it doesn't make Stop instant, it caps how long Stop can be
> ignored.

**Still open in this arc:** remote monitoring + remote stop for channel-driven tasks; a per-turn
no-progress watchdog; the approval-stall budget.

### Arc 4 — Did it actually work? — PARTIALLY SHIPPED

**`wait_for` (SHIPPED).** The observe-until-condition primitive. Conditions: `text_appears` /
`text_disappears` (needs `text`) · `app_appears` / `app_closes`. Read-only, so no plan; the text
conditions read an app's tree and therefore enforce the same `read` tier `snapshot_app` does, on
**every poll**, so a grant revoked mid-wait stops the wait. Bounded twice (per-attempt timeout in
the probe, hard deadline here, 60 s ceiling). Checks the condition **immediately** before sleeping —
the thing being waited for has often already happened. A transient probe failure is retried rather
than treated as "condition false", which is also what makes `app_closes` work.

Instructions + playbook now teach: wait with `wait_for`, then **confirm** — a tool returning success
means the action was *sent*, not that it worked.

**Review caught three real defects in `wait_for`, all fixed before it shipped:**

- **A permission refusal reported as SUCCESS.** Collapsing "the read failed" into "the tree is
  empty" made a *denied grant* satisfy `text_disappears` on the first attempt — the model was told
  the dialog closed and never told about the denial. Observations are now a discriminated union
  (`read` / `open-state` / `unreadable`); an unreadable app proves nothing about content, and only
  `app_closes` may treat it as an answer. A `ForbiddenError` now aborts the wait instead of being
  retried for the whole budget, so the recovery path reaches the model immediately.
- **Electron apps inverted.** Existence went through `listOpenApps` alone, which is xa11y's
  `App.list()` — and Electron apps don't appear there. `app_closes` on a *running* Discord returned
  "met" instantly; `app_appears` never fired. Now falls back to `findWindowedPidByName`, the same
  resolution the rest of the package uses.
- **The Electron poll stole focus repeatedly.** Polling `snapshotApp` meant a COLD wake per poll:
  un-minimise the user's window, steal the foreground, and — when activation is refused — send a
  bare **Alt keypress into whatever they are currently typing**, plus set/clear the global
  `SPI_SETSCREENREADER` flag each cycle. `window-focus.ts` permits that side effect precisely
  because it "fires at most once per wake"; polling broke the invariant that made it acceptable.
  New `openAppTreeReader` resolves ONCE and holds the wake for the whole wait, re-authorizing per
  read so the revoked-grant property survives. The tool description now discloses the one
  foreground grab, as `snapshot_app` already did.

> ⚠ **Live smoke inconclusive, deliberately not claimed as passing.** The PowerShell WinForms
> fixture used to conjure a throwaway window launches unreliably from a background shell (the same
> window was visible one minute and absent the next), so the end-to-end run proved nothing either
> way. The logic is unit-verified (25 tests, injected probes + fake clock). **Worth exercising in
> Chad's browser smoke:** `wait_for` on a real app — a hit, a timeout, and one on an Electron app
> (Discord) where the held wake and the pid fallback both matter.

### Arc 3 (original scope) — Supervision: stop it, watch it, bound it

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

### Arc 5 — Capability fills — SHIPPED (`94b9c56` + `36564b3`)

Four fills, no new dependency (nut.js and node-screenshots already shipped what was missing), all
verified against the real desktop:

- **`read_clipboard` / `write_clipboard`** — the reliable route for "copy from A, paste into B".
  Both gated by `unattendedRefusalError`, **not** the plain plan check: the clipboard is app-less,
  so there is no standing-grant second door and `isArmed()` alone would be the whole authorization —
  which the model grants itself. They now additionally require real consent and refuse under
  `display-only`. `read_clipboard`'s output is **not persisted** to the transcript
  (`toolOutputForStorage`, in contracts) — its output *is* whatever the user last copied.
- **`list_monitors`** — display topology. Ungated (a screen's existence reveals nothing about its
  contents). Handles the Monitor API's mixed units: origin is virtual-desktop, size is physical.
- **Stepped drag** — nut's `drag()` was a single jump, which moves a slider but never completes a
  drop. Now threshold-nudged, interpolated, denser for long paths, with a guaranteed release.
- **`move`** (hover) — opens hover menus and tooltips; `click` tier, same two walls as a click.

**Review caught three real problems**, all fixed in `36564b3` — the clipboard being open to
unattended turns, a timed-out drag able to leave the mouse button held down desktop-wide, and
clipboard plaintext persisted forever. The full reasoning is in that commit message.

### Arc 5 (original scope) — remaining cheap fills

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

### Arc 7 — Voice in calls — MOVED OUT (2026-08-11)

**No longer tracked here.** Kafi handed this to a separate session working in its own worktree; the
self-contained brief is `docs/module-notes/voice-in-calls.md`. The scoping below is kept only as the
record of how it was split — do not treat it as this plan's backlog.

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
