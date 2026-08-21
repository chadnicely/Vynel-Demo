# Vynel

A desktop AI assistant for non-technical people that wraps Claude Code (via
`@anthropic-ai/claude-agent-sdk`) in a trustworthy experience layer: visible memory, curated
skills, an approval card on every irreversible action, channels (Telegram, Voice), and
scheduled tasks. Built as a modular monolith — feature packages in `packages/` over one shared
`@vynel/db` kernel, with thin app surfaces in `apps/`.

Start with `docs/vision.md` (what we're building) and `docs/architecture.md` (the shape).

## Service ports

Every service sits on one contiguous 5-digit serial starting at 18890:

| Port  | Service          | Where it runs                                  |
| ----- | ---------------- | ---------------------------------------------- |
| 18890 | Cloud hub        | `apps/cloud-api`                               |
| 18891 | Admin portal     | `apps/cloud-admin-web` (Vite dev server)       |
| 18892 | Engine API       | `apps/local-api` (loopback-only daemon)        |
| 18893 | Voice daemon     | `apps/voice` (loopback overlay channel)        |
| 18894 | Web dev server   | `apps/local-web` (Vite, proxies `/api` + `/voice`) |

The next new service takes **18895** — always the next number in the serial, never an arbitrary
free port.

All five ports have ONE home: `packages/contracts/src/network/ports.ts`, where the band is
`VYNEL_PORT_BASE` (default 18890) + fixed offsets. Every app's port *and* derived-URL defaults flow
from it, so setting one env var shifts a whole instance coherently. The copies TypeScript can't
reach (`apps/desktop/src-tauri/src/engine_port.rs` and `tauri.conf.json`'s
`frontendDist`/`devUrl`) are guarded by `scripts/src/generators/check-port-parity.ts`, which fails
`pnpm test` the moment they drift.

The ports above are *preferred*, not assumed: the installed desktop app allocates the engine port
each boot (canonical first, scan on conflict) and the engine advertises where it actually bound in
`~/.vynel/engine.port` — clients (CLI, MCP, voice, the shell windows) resolve explicit env → live
port file → band default.

## Development

```bash
pnpm install
pnpm dev          # the classic trio: hub (18890) + engine API (18892) + web dev server (18894)
pnpm dev:full     # the above + admin portal (18891) + voice daemon (18893)
pnpm dev:desktop  # rebuild the Tauri shell — see below
pnpm test         # the gate: typecheck + schema/MCP/port parity + vitest
```

`pnpm dev` also takes app names and a port band, so you start exactly what you need:

```bash
pnpm dev api web                      # just the engine + UI, no Postgres
pnpm dev cloud admin api web voice    # the full stack (same as dev:full)
pnpm dev api web --base 28890         # same apps on another band (engine 28892, web 28894)
pnpm dev api --port 28892             # same flag, named by the engine port (base = port − 2)
pnpm dev --help                       # the full alias roster
```

Aliases: `api`/`engine`, `web`/`ui`, `cloud`/`hub`, `admin`, `voice`, `worker`, `desktop`/`shell`.
Hub apps (`cloud`, `admin`) bring the Postgres container up first automatically. `--base` sets
`VYNEL_PORT_BASE`, and *everything* — ports and the URLs between apps — shifts together; the flags
work on `dev:local` and `dev:full` too.

Copy `.env.example` to `.env` to adjust local settings. For a second checkout (a git worktree), run
`pnpm worktree:env` inside it once — it copies the main `.env` and claims a free port band so both
instances run side by side.

### Rebuild the Tauri shell after a port or config change

No `dev` script builds the desktop shell — `dev:full` runs the five *services*, while the window
the voice daemon opens on wake is the already-compiled
`apps/desktop/src-tauri/target/debug/vynel-desktop.exe` (`apps/voice/src/overlay/display-dock-window.ts`
prefers it whenever the file exists). Tauri bakes `devUrl` and `frontendDist` into that binary **at
compile time**, so a `tauri.conf.json` change leaves the old URLs live in the exe and no amount of
restarting `dev:full` heals it — the overlay just loads a dead port. A shell exe that *crashes* at
launch is caught: the daemon watches the spawn and falls back to a Chrome/Edge app-window on
`/display-dock`, logging a rebuild pointer — but a stale exe that still runs (wrong baked port) renders
its dead page, so rebuild after any port/config change.

A port change therefore has to reach **every compiled or packaged copy**, not just the sources the
parity check guards:

| Artifact                        | Rebuild with          |
| ------------------------------- | --------------------- |
| `target/debug/vynel-desktop.exe` (the dev/voice overlay) | `pnpm dev:desktop`    |
| `target/release/.../Vynel_<v>_x64-setup.exe` (the installer) | `pnpm release:desktop` |
| `dist-payloads/` (the remote engine for a server install) | `pnpm release:payload` |
