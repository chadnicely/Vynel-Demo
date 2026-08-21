# apps/ — deployables (thin)

Each app is something that **runs**. Thin adapters over `packages/`. Never imported by a package.
Fills in as we move code (see `../docs/architecture.md` §7). Intended surfaces:

- **api** — Hono HTTP + SSE daemon; the brain process (local in P1, cloud in P2). Hosts the session
  runtime + boot services (channels, schedules, delegation).
- **web** — Vue 3 SPA (chat, panels, settings).
- **desktop** — the shell hosting `web` + the voice overlay (Tauri today; Tauri-vs-Electron is open).
- **voice** — the always-on voice channel: wake-word → STT → TTS → `/root/turn` → speak.
- **worker** — in-process cron scheduler (P1) → queue (P2).
- **mcp** — external MCP server + the generated tool registry.
- **cli** — NEW: the `vynel` CLI over `@vynel/sdk` (net-new surface).

All surfaces call the same core; a "desktop request" flows through the `desktop-control` MCP
descriptor attached to the session — not a bespoke path.
