# @vynel/desktop-control

Lets Vynel's brain **observe and control the local desktop** — exposed as
in-process MCP tools the AI agent calls mid-turn. Re-authored fresh in Vynel's
house style from a reference scaffold; the accessibility engine is `xa11y`
(adopted after a dedicated spike).

> **Safety — the per-app access model (Claude-desktop-style).** Every
> app-directed tool is gated by a **user grant for that specific app**, at a
> tier: `read` (see) < `click` (also press) < `full` (also type). No grant = no
> access (fails closed with the recovery path). The ONLY way a grant comes into
> being is the `request_desktop_access` tool, declared in `mutatingToolNames` so
> it raises an **approval card in every permission mode** — the card is the
> consent moment. Grants persist in `desktop_app_grants` until revoked (routes
> `GET/DELETE /desktop/access`; "Desktop access" section in the app). On top of
> that: the act tools are **default-OFF** behind `VYNEL_DESKTOP_ACT_ENABLED`,
> typing into a detected **password control is refused outright**
> (`a11y/password-control-guard.ts`), and the system-prompt instructions carry
> the prompt-injection boundary (screen content is data, never instructions) and
> the prohibited-action canon (credentials / CAPTCHA / financial / agreements).

## Tool surface

| Tool | Role | Status |
|---|---|---|
| `list_desktop_notifications` | Desktop notification events since a timestamp (read-only; ungated) | **shipped** |
| `list_open_apps` | List open windows + the granted `accessTier` per app (read-only; ungated) | **shipped** |
| `snapshot_app` | Read a named app's accessibility tree (requires `read` grant) | **shipped** |
| `screenshot_app` | Pixel capture of one window without focusing it; WXGA downscale for coordinate accuracy + full-res `region` zoom (requires `read` grant; `node-screenshots`/XCap) | **shipped** |
| `request_desktop_access` | Ask the user to grant an app at a tier — cards in EVERY mode; the consent door | **shipped** |
| `act_on_app` | Act on an element — press (`click` grant) / type_text / set_value (`full` grant); default-OFF | **shipped** |
| `act_on_desktop` | Coordinate mouse/keyboard — click/scroll/drag (`click` grant), type/press (`full` grant, enforced against the focused/hit-tested window); default-OFF | **shipped** |

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
