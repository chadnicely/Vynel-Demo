# Ports — consolidation + allocation arc

Chad's advice (2026-08-13): every port comes through env; a worktree gets its own port band via
one allocator script; the release smoke boot must never use a fixed port (Docker Desktop's
reserved ranges swallowed 8996 and blocked a build); and the *distributed* desktop app cannot
assume any port — on an end user's machine the port is allocated at every start.

## Inventory (before this arc)

| Port  | Role                     | Where it lived                                                        |
| ----- | ------------------------ | --------------------------------------------------------------------- |
| 18890 | cloud-api                | literal in `apps/cloud-api/src/env.ts`, `scripts/src/cloud/*`, proxy  |
| 18891 | cloud-admin-web dev      | literal in `apps/cloud-admin-web/vite.config.ts`                       |
| 18892 | engine (local-api)       | `VYNEL_ENGINE_PORT` in contracts + Rust/Tauri copies (parity-guarded) |
| 18893 | voice daemon             | `VYNEL_VOICE_DAEMON_PORT` in contracts                                 |
| 18894 | local-web dev            | literal in `apps/local-web/env.ts` + dock URL + tauri devUrl           |
| 8996  | release smoke boot       | literal `SMOKE_PORT` in `scripts/src/release/smoke-boot.ts`            |

## Root causes

1. **Stray literals** outside the contracts home (`packages/contracts/src/network/ports.ts`).
2. **URL defaults baked from constants** — overriding `PORT` in a worktree `.env` moves the
   listener but not the ~6 URL defaults that point at it, so copying `.env` can't shift an
   instance.
3. **Fixed ports where fixed can never be safe** — the smoke boot (Docker/Hyper-V excluded
   ranges) and the shipped desktop app (anything may hold 18892 on a customer machine).

## The steps

1. **Smoke boot allocates.** Kill `SMOKE_PORT`; each proof-of-life run bind-probes a free
   ephemeral port (host for the native path, inside the distro for the WSL path) and passes it
   as `PORT`. A fixed test port loses the reservation lottery eventually — always.
2. **One home, base + offsets.** The band is `VYNEL_PORT_BASE` (default 18890) + fixed
   offsets: cloud-api +0, cloud-admin +1, engine +2, voice +3, local-web +4.
   `resolveVynelPorts(base)` in contracts is the single derivation; every app `env.ts` derives
   its port *and URL* defaults from it. Explicit per-var overrides still win. All stray
   literals become imports.
3. **Worktree allocator.** `scripts/src/dev/setup-worktree-env.ts`: copy the root `.env`,
   scan sibling worktrees for claimed bands, bind-probe candidate bands in steps of 10,
   write `VYNEL_PORT_BASE=<free band>` into the worktree `.env`. Claude runs it whenever a
   worktree is created. One variable moves the whole instance coherently.
4. **Port-file discovery.** The engine writes the port it *actually* bound (plus pid) to
   `<user data dir>/engine.port` at boot; clients (cli/mcp/voice/shell) resolve:
   env override → live port file → band default (`resolveEngineUrl`, one home in
   contracts `network/port-file.ts`). Stale files (dead pid) are ignored. This is what
   makes dynamic ports safe — nothing trusts a constant when a daemon is running.
   *Voice deferred:* the voice daemon never allocates dynamically (it fails fast on an
   occupied port), so a `voice.port` file would only mirror its env — add it when the
   daemon learns dynamic binding.
5. **Desktop shell allocates per boot.** `daemon.rs` stops hardcoding: candidates are
   env `VYNEL_ENGINE_PORT` → sticky last-used port → canonical → upward scan. It spawns the
   daemon with the chosen `PORT` and opens windows at the runtime URL. Sticky-first keeps the
   URL stable across reboots for the common case; the scan makes an occupied port a
   non-event. `check-port-parity.ts` evolves to pin the canonical *preferred* constants in
   the Rust/Tauri copies rather than pretending the port is fixed.

## Gates

`pnpm test` green after every step; one conventional commit per step; code-reviewer on the
full diff before shipping. Rust changes additionally `cargo check` when the toolchain is
available (Tauri build verified by Chad otherwise).

## Non-goals

- No change to the *canonical* band (1889x) — it stays the preferred, documented default.
- No per-feature physical config split — the one home stays `@vynel/contracts`.
- Loopback-only binding is unchanged; env-driven ports are operability, not a security
  boundary.
