# @vynel/desktop-control

Lets Vynel's brain **observe and control the local desktop** — exposed as
in-process MCP tools the AI agent calls mid-turn. Re-authored fresh in Vynel's
house style from a reference scaffold; the accessibility engine is `xa11y`
(adopted after a dedicated spike).

> **Safety:** the read tools observe whatever is on a named app's screen, and
> `act_on_app` (click / type) is **default-OFF** behind `VYNEL_DESKTOP_ACT_ENABLED`
> with `destructiveHint`. The hard approval-card gate is a separate step (spec:
> `.claude/ceo/desktop-control/act-approval-hook-spec.md`); until it lands, the
> interim safety for actions is an isolated environment + the flag, not the prompt.

## Tool surface

| Tool | Role | Status |
|---|---|---|
| `list_desktop_notifications` | Desktop notification events since a timestamp (read-only) | **shipped** |
| `list_open_apps` | List open windows the agent can target (read-only) | **shipped** |
| `snapshot_app` | Read a named app's accessibility tree (read-only) | **shipped** |
| `act_on_app` | Act on an element — press / type_text / set_value (mutating; default-OFF) | **shipped** |
| `screenshot` / `click_xy` | Pixel capture + coordinate fallback | deferred (element-addressing preferred) |

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
