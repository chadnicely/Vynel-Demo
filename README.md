# Vynel

A desktop AI assistant for non-technical people that wraps Claude Code (via
`@anthropic-ai/claude-agent-sdk`) in a trustworthy experience layer: visible memory, curated
skills, an approval card on every irreversible action, channels (Telegram, Voice/Jarvis), and
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

The engine and voice ports have ONE home: `packages/contracts/src/network/ports.ts`. Every
TypeScript consumer imports it; the two copies TypeScript can't reach (`apps/desktop/src-tauri/src/daemon.rs`
and `tauri.conf.json`'s `frontendDist`) are guarded by `scripts/src/generators/check-port-parity.ts`,
which fails `pnpm test` the moment they drift. The hub, portal, and web ports default in their own
`env.ts` / `vite.config.ts`.

## Development

```bash
pnpm install
pnpm dev     # engine API (18892) + web dev server (18894)
pnpm test    # the gate: typecheck + schema/MCP/port parity + vitest
```

Copy `.env.example` to `.env` to adjust local settings.
