# @vynel/desktop-control

Lets Vynel's brain **observe and control the local desktop** — exposed as
in-process MCP tools the AI agent calls mid-turn. Re-authored fresh in Vynel's
house style from a reference scaffold; the accessibility engine is `xa11y`
(adopted after a dedicated spike).

> **Safety — the plan is the consent.** Desktop work splits in two:
>
> - **Looking** (`list_*`, `snapshot_app`, `screenshot_app`, `wait_for`,
>   `system_status`) is **ungated** and raises no overlay. Reading needs no plan
>   by design — you often have to look to work out *what* to plan.
> - **Acting** (`act_on_app`, `act_on_desktop`, `launch_app`,
>   `set_window_state`, `set_window_bounds`, clipboard) requires the turn's
>   **approved plan**, which names every app it will touch and at which tier
>   (`read` < `click` < `full`), and which narrates on an overlay while it runs.
>   No armed plan, or an app the plan does not name, = refused.
>
> Per-app grants and `request_desktop_access` were **retired 2026-08-13**: they
> asked a second time for consent the plan already carries, in a vocabulary a
> non-technical user cannot evaluate (the cards this package generated in
> practice said *"Docker Desktop Launcher"* and *"Application Frame Host"*).
>
> On top of that: the act tools are **default-OFF** behind
> `VYNEL_DESKTOP_ACT_ENABLED`, typing into a detected **password control is
> refused outright** (`a11y/password-control-guard.ts`), and the system-prompt
> instructions carry the prompt-injection boundary (screen content is data,
> never instructions) and the prohibited-action canon (credentials / CAPTCHA /
> financial / agreements).
>
> ⚠ **Known, deliberate debt.** A channel turn (e.g. Telegram) can act with no
> approval anywhere — the overlay and a future access log are the
> accountability. The turn's origin is already known at
> `run-global-root-turn.ts`, so per-channel trust is a later filter, not a
> redesign.

## Tool surface

| Tool | Role | Status |
|---|---|---|
| `list_desktop_notifications` | Desktop notification events since a timestamp (read-only; ungated) | **shipped** |
| `list_open_apps` | List open windows (read-only; ungated) | **shipped** |
| `snapshot_app` | Read a named app's accessibility tree (read-only; ungated) | **shipped** |
| `screenshot_app` | Pixel capture of one window; WXGA downscale for coordinate accuracy + full-res `region` zoom. Restores a minimized window first (read-only otherwise; `node-screenshots`/XCap) | **shipped** |
| `system_status` | CPU / memory / battery / disks / busiest programs (read-only; ungated) | **shipped** |
| `act_on_app` | Act on an element — press (`click`) / type_text / set_value (`full`), against the approved plan; default-OFF | **shipped** |
| `act_on_desktop` | Coordinate mouse/keyboard — click/scroll/drag (`click`), type/press (`full`, enforced against the focused/hit-tested window); default-OFF | **shipped** |

## How it plugs into Vynel

- **The listener is a process-wide resource**, not a per-session tool. `apps/local-api`
  creates ONE `createDesktopNotificationListener(...)` at boot (alongside `db`),
  injects its read interface into `c.var.desktopNotifications`, and stops it on
  shutdown. Starting a poller per chat session would leak processes.
- **The MCP tool is a thin reader.** `buildDesktopMcpServer({ reader })` returns a
  `createSdkMcpServer` (server name `desktop` → tools are `mcp__desktop__*`),
  wired into the **global "hey jarvis" brain**'s turn alongside the routing
  server, so the always-on assistant can answer "what notifications came in?".

## Notifications backend

- **Windows** — spawns `notification-listener.ps1`, which drives the WinRT
  `UserNotificationListener` and streams one JSON object per line (NDJSON). No
  native npm module. Requires the OS notification-access grant (Settings →
  Privacy & security → Notifications); the helper exits non-zero if denied. The
  helper receives the spawning process's id (`-ParentPid`) and self-exits when
  that process is gone, so even an abrupt api crash (where the graceful `stop()`
  never runs) cannot orphan the poller.
- **macOS / Linux** — no backend yet (null backend; `listSince` returns `[]`).

## Privacy posture (locked — "visible + redact codes")

Desktop notifications routinely carry **2FA one-time codes and DM contents**.
Two guards, by design:

1. **Redaction at ingest.** One-time / verification codes are stripped by
   `redactOneTimeCodes` **before** an event ever enters the in-memory buffer —
   the raw code is never stored and never reaches the agent. Best-effort, not a
   guarantee; documented as such.
2. **Ephemeral + visible.** Notifications live in a bounded in-memory ring buffer
   only — **never persisted to the database** (persisting codes would be the
   leak). The listener is started deliberately at boot and logged; an explicit
   user on/off control + "listening" affordance mirror the voice mic precedent.

## Prerequisite

Windows PowerShell 5.1 (built into Windows — `powershell.exe`) for WinRT type
access. The package shells out to it; nothing to install.
