# Bringing a window to the front — the measured verdict

**Question (Kafi, 2026-08-22):** *"Research and verify how we can bring a desktop app to the front —
acting with any desktop application needs that window in front, and this limitation is why we are
failing to use the desktop control tool properly."*

**Verdict: for most apps we never ask for the foreground at all.** The foreground lock is real and
we *can* beat it — but that turns out not to be the headline. `ensureForeground()` has exactly **one
call site**: inside `runWakeLoop`, on the Electron/`byPid` fallback path. Any app that xa11y can
enumerate — native, Qt, Telegram, Explorer, qBittorrent — takes the early return in
`resolveAppWithFallback` with `focusSucceeded: null` and **is never focused**. And no tool exposes
"bring this window to the front": the desktop surface has `set_window_state` (minimize/maximize) and
`set_window_bounds` (move/resize), but nothing that raises a window.

So the limitation Kafi hit is most likely not the lock refusing us. It is that **there is no code
path that asks.**

Four separate problems wear one symptom. Keeping them apart is the whole point of this note.

| | Problem | Status |
|---|---|---|
| **0. Reach** | Do we even try to focus? | **No — for every UIA-enumerable app.** One call site, Electron-only. No `focus_window` tool exists |
| **1. Targeting** | Which HWND do we mean? | **Broken, fixable now** — we address windows by `Get-Process().MainWindowHandle` |
| **2. Permission** | Will Windows let us raise it? | **Solvable** — one technique works, and it is the one we happen to ship |
| **3. Latency** | What does one attempt cost? | **~1235 ms of PowerShell**, replaceable with ~50–90 ms in-process |

> **Confirmed by Kafi, 2026-08-22:** *"In our tool we have a maximize option but no option to bring
> any background window to foreground — there is no function we have yet."* Problem 0 is the story.
> Problems 1–3 are what the new function must not repeat.

---

## 1. Targeting — the real defect

`window-focus.ts`, `window-state.ts` and `window-bounds.ts` all reach a window as
`Get-Process -Id <pid>).MainWindowHandle`. That is one handle per **process**, and it is wrong three
ways:

- **Multi-window apps.** Chrome had **three** windows on pid 5488 during the measurement. One
  `MainWindowHandle` cannot name the one we mean. `window-state.ts` already documents this as a
  known limit — *"Fixing it needs a real HWND, which the capture binding doesn't expose."*
- **Tray/hidden apps** report `MainWindowHandle = 0`.
- **Packaged (UWP) apps** share one `ApplicationFrameHost` pid across Calculator, Settings, Store…

**That comment is now out of date: the capture binding does expose a real HWND.**
`node-screenshots`' `Window.id()` *is* the HWND. Verified by cross-join — all **23** windows from
`Window.all()` appear in libnut's 889 raw handles with matching titles, and the focused window's
`id()` equals `libnut.getActiveWindow()` exactly:

```
node-screenshots ids: 23 | libnut handles: 889 | ids present in BOTH: 23
ns focused id: 135776 Google Chrome | libnut active: 135776
```

This matters beyond convenience: **targeting then comes from the same source as identity**
(`window-identity.ts` already reads `Window.all()`), so there is no cross-source join to drift —
the class of bug the `resolveAppIdentity` comment exists to warn about.

Proof it works: with the lock armed, focusing Chrome window **#2 of 3** by HWND brought up
`"desperate meaning in bengali…"` — *not* the foreground-most Chrome window. `MainWindowHandle`
cannot express that request at all.

## 2. Permission — the foreground lock, measured

### The ladder

Ten techniques, each run in a **fresh process** against a **demonstrably armed lock**, 3 trials per
target, across a native app (qBittorrent), an Electron app (Discord) and a multi-window Chrome.
`reported` is the API's own return value; `took` is whether `GetForegroundWindow()` actually moved.

| Rung | reported | **actually took foreground** |
|---|---|---|
| `SetForegroundWindow` alone | `False` | **0 / 9** |
| **Shift tap → `SetForegroundWindow`** | `True` | **9 / 9** ✅ |
| **Ctrl tap → `SetForegroundWindow`** | `True` | **3 / 3** ✅ |
| **Alt tap → `SetForegroundWindow`** *(what we ship)* | `True` | **6 / 6** ✅ |
| `AttachThreadInput` + `BringWindowToTop` + `SetActiveWindow` + SFW | `attached=True`, sfw=`False` | **0 / 9** ❌ |
| `SwitchToThisWindow(hwnd, TRUE)` | *(void)* | **0 / 3** ❌ |
| `WScript.Shell.AppActivate(pid)` *(our rung 1)* | **`True`** | **0 / 9** ⚠ |
| `ShowWindow(SW_MINIMIZE)` → `SW_RESTORE` | **`True`** | **0 / 3** ⚠ |

### What that says

**Only one thing defeats the lock: the calling process must have injected input first.** MSDN's
condition is *"the process received the last input event"* — and injecting a keystroke yourself
satisfies it. Nothing else on the list works.

**Two widely-recommended techniques do not work on Windows 11.** `AttachThreadInput` and
`SwitchToThisWindow` are the two answers you will find on every forum thread about this. Both were
refused, 0/12 combined, on a fully armed lock. Do not reach for them.

**⚠ Two of the failures return `True`.** `AppActivate` and `ShowWindow` both report success while
the foreground never moves — `AppActivate` merely flashes the taskbar button. `window-focus.ts` is
already right to verify against the real foreground pid rather than trust a boolean; this is the
measurement that justifies that design. **Never trust the return value.**

**Alt is doing the work, and Alt is the rung with a side effect.** `window-focus.ts` documents it
honestly: the Alt lands on whatever currently has focus and *"can arm that app's menu bar until its
next keypress."* **Shift defeats the lock exactly as well (9/9), and Ctrl too (3/3).**

**Shift is *narrower* than Alt, not free.** Any injected modifier lands on whatever app currently has
focus, and Shift is live in real UIs — it extends selections in editors, lists and file managers, and
a Shift down/up straddling an in-flight click or keystroke changes that event's meaning. Ctrl is
worse (Ctrl+click, Ctrl+A). This is the same class of side effect Alt was flagged for, just smaller:
Alt arms a menu bar and is visible; Shift is usually inert but not always. Note too that this
injection bypasses the reasoning in `authorizeFocusedTarget`, which treats "keystrokes land in
whatever has focus" as an enforcement-relevant fact. Swapping Alt → Shift is a real improvement and
should be described as reducing the blast radius, never as eliminating it.

### The lock's lifecycle — the finding that reframes the problem

**Once anything defeats the lock, it stays defeated until real user input re-arms it.** After the
first successful grab, plain `SetForegroundWindow` — refused 0/9 a moment earlier — began passing
every time. Practical consequences:

- **Only the *first* focus grab of a work session is contested.** A multi-step desktop task pays the
  lock once, not per step.
- **On an idle machine there is often no lock at all.** Windows lifts it entirely once the user has
  been idle past `ForegroundLockTimeout` (200 000 ms here). The unattended, dedicated-machine
  posture of `desktop-control-input-methods.md` is the *easy* case.
- **This is a measurement trap**, and it invalidated two earlier passes of this very research before
  the fixture below existed — see *Method*.

## 3. Latency — ~1235 ms per attempt

`ensureForeground()` is up to **five** sequential PowerShell spawns (`restoreIfMinimized` → activate
→ verify → force → re-verify), each paying an `Add-Type` C# compile. Measured:

| | cold | warm |
|---|---|---|
| `powershell -Command 1` (floor) | 167 ms | 144 ms |
| `Add-Type` + `GetForegroundWindow` | 326 ms | 253 ms |
| `Add-Type` + `ShowWindow`/`IsIconic` | 293 ms | 278 ms |
| `Get-Process` window list (`findWindowedPidByName`) | 294 ms | — |
| **full `ensureForeground()` worst case** | — | **1235 ms** + a 150 ms in-script sleep |
| **`node-screenshots` `Window.all()` + `isFocused()`** | — | **1.8 ms** |

The foreground *read* alone is ~700× cheaper in-process. And because rung 1 (`AppActivate`) reports
`True` while failing, we spend two spawns (~500 ms) discovering that before reaching the rung that
works — every single time.

Inside the 12 s Electron wake deadline, `ensureForeground` runs up to twice — so **~2.5 s of a cold
Discord wake is PowerShell process startup**, before any accessibility work begins.

## The recommended fix — verified end to end

Everything below uses libraries `@vynel/desktop-control` **already depends on**. No new install
surface.

0. **Close the reach gap first — it is the one that matters.** Two parts, and they are separable:
   *(a)* make focusing reachable on the `App.find` path too, not only the Electron wake, so
   `act_on_app` on Telegram or Explorer raises the window it is about to act on; *(b)* consider a
   first-class `focus_window` tool, so "bring X to the front" is a thing the model can *ask for*
   rather than a side effect it has to trigger by picking a different tool. **(b) is a product call
   for Kafi, not a refactor** — and note it is a mutating, user-visible action, so it belongs in the
   plan envelope with the other actuating tools.
1. **Target by real HWND** from `node-screenshots` `Window.id()` — the same source that already owns
   identity and enforcement.
2. **Tap Shift, settle, then focus — all in ONE process.**
3. **Verify** via `isFocused()` (1.8 ms), retry once. Keep the existing verify-don't-trust contract.

```
libnut.keyToggle('shift', 'down'); libnut.keyToggle('shift', 'up')
await delay(~80ms)                       // REQUIRED — see below
libnut.focusWindow(hwnd)                 // ShowWindow(SW_RESTORE) if iconic + SetForegroundWindow
```

Measured against the armed-lock fixture: **6/6, 50–90 ms total** (vs ~1235 ms). Restore-if-minimized
comes free — libnut's `focusWindow` already does `SW_RESTORE` when `IsIconic` — so
`restoreIfMinimized`'s spawn disappears too.

### ⚠ Raising a window must not silently un-maximize it

**`SW_SHOWNOACTIVATE` (4) restores a window to its *normal* size, discarding the maximized state.**
Demonstrated live and unintentionally during this research: qBittorrent started maximized, the
harness used `SW_SHOWNOACTIVATE` to park it behind the fixture, and it came back as a 686×796
window. Kafi noticed from the screen before the harness noticed from the data.

`SW_RESTORE` (9) is the safe one — on a maximized-then-minimized window it correctly returns to
**maximized**, which is exactly why `restoreIfMinimized` already uses it, and why libnut's
`focusWindow` (which calls `SW_RESTORE` when `IsIconic`) is safe to build on.

The rule for the new focus function: **raising a window is not permission to resize it.** Only ever
un-minimize, never normalize, and leave a non-minimized window's geometry untouched — the same
IsIconic-gated discipline `window-state.ts` already documents. A focus call that quietly shrinks the
user's maximized window is a worse bug than failing to focus at all, because it is invisible in the
return value and permanent.

### Two traps in that snippet

- **Both the keystroke and the settle are required — neither alone is enough.** Run as a 2×2, which
  is the only way to tell "the settle fixed it" from "the keystroke never fired":

  | | no settle (~2 ms) | 80 ms settle |
  |---|---|---|
  | **no keystroke** | 0 / 3 | **0 / 3** |
  | **Shift tap** | 0 / 9 | **6 / 6** ✅ |

  The bottom-left cell proves the settle matters; the **top-right cell proves the keystroke is the
  actual mechanism** and that `libnut.keyToggle('shift', …)` really fires. The injected key has to be
  processed by the system before `SetForegroundWindow` is evaluated. Today's PowerShell gets that gap
  for free from process startup; an in-process port must make it explicit.
- **Same process, or nothing.** The input credit belongs to the process that injected. Tapping the
  key in Node and calling `SetForegroundWindow` from PowerShell would break — and so would reaching
  for **`libnut.focusWindow()` on its own, which is bare `SetForegroundWindow` and was refused
  0/9.** It is only a fix in combination with the keystroke.

## What still blocks us (honest list)

1. **Elevated windows (UIPI).** Task Manager could not be driven; it also could not be held in a
   valid pre-state, so its rows are reported as inconclusive rather than as failures. Unchanged from
   `desktop-control-input-methods.md`: the answer remains a `uiAccess="true"` manifest once
   Authenticode signing lands, or nothing.
2. **The secure desktop.** Unfixable by design.
3. **Packaged (UWP) apps.** Calculator repeatedly refused to yield the foreground, which broke the
   pre-state for other targets. Compounds the known xa11y limit (*"only one packaged app is readable
   at a time"*, `desktop-autopilot.md`).
4. **A genuinely active user.** Every measurement here injected its own input. If a human is typing
   at the exact moment we grab focus, we are racing them and the grab is rude even when it wins.
   Worth a product rule — not a technical one.
5. **Tray-hidden apps** still have no window to raise; `trayHiddenMessage` remains the right answer.

## Method — and why the first two passes were wrong

Three traps invalidated earlier passes. Recording them because each produces *confident, clean-looking,
false* results:

- **`SPI_SETFOREGROUNDLOCKTIMEOUT` is a persistent machine-wide setting.** A first pass set it to 0
  mid-run, so every later rung silently ran with focus-stealing prevention **disabled**. It also left
  Kafi's machine that way until it was spotted and restored (live value back to 200000; the registry
  was never touched).
- **The lock stays released once defeated.** Alternating control/treatment cannot work: the treatment
  releases the lock for the control that follows. Every rung needs a *freshly armed* lock.
- **An unattended machine has no lock to measure.** Past `ForegroundLockTimeout`, everything passes.

The instrument that fixes all three: a **fixture window** that takes the foreground and calls
`LockSetForegroundWindow(LSFW_LOCK)` — the same call the system makes on user input — giving a
reproducible "a user is actively working" state with no human present. One fixture per trial, one
rung per process, and every trial refuses to report unless the fixture verifiably owns the
foreground. The `control` rung is the assay: it must keep failing, or the harness has leaked
privilege.

Scripts: `scratchpad/{locker,ab-locked}.ps1`, `run-locked.sh`, `inproc-focus.mjs`.

**Not claimed — three limits on how far these numbers reach:**

- **Process posture.** These ran in a windowless child process with no foreground claim, not a fully
  detached service (Claude Code's job object kills detached children). The permission rules key on
  input credit and foreground ownership, both verified absent per trial — but a service-hosted run
  has not been measured.
- **The in-process 6/6 is narrower than the ladder's 30/30.** The recommended path was proved against
  the *synthetic* fixture window on one target (qBittorrent). The ladder covered three real apps; the
  in-process port has not. Real apps behaved less uniformly than the fixture — Calculator repeatedly
  refused to yield the foreground, Task Manager could not be held in a valid pre-state at all — so
  expect the port to need its own pass against Electron and UWP before it is trusted.
- **No end-to-end reproduction.** No failing `snapshot_app`/`act_on_app` call was reproduced; this
  note measures Win32 primitives and reads the call graph. That is why the headline is marked
  conditional on Kafi naming the app and the tool call.

## Sources

- [SetForegroundWindow — the conditions a process must meet (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
- [LockSetForegroundWindow (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-locksetforegroundwindow)
- [SPI_SETFOREGROUNDLOCKTIMEOUT — SystemParametersInfo (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)
- [libnut-core `focusWindow` — `ShowWindow` + `SetForegroundWindow`](https://github.com/nut-tree/libnut-core/blob/master/src/win32/window_manager.cc)
- Sibling note: [`desktop-control-input-methods.md`](./desktop-control-input-methods.md) — how to click and type once the window *is* in front.
