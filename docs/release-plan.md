# Vynel — production build & distribution plan

**Status:** proposed 2026-07-28 · supersedes the D2 plan of 2026-07-27 (deleted), which shipped the
readable TS source tree via tsx — rejected by Chad: the local-api codebase must not be trivially
readable on user machines.

## The core principle: one compiled payload, three delivery modes

All of Vynel's IP (`packages/*` + `apps/local-api`) is **compiled into one minified esbuild bundle**.
What ships is that bundle + third-party `node_modules` + asset dirs + a pinned Node runtime — never
our TypeScript source. The same payload, built per platform, feeds all three modes:

1. **Local desktop** — Tauri installer bundles the win-x64 payload; the shell supervises it.
2. **SSH server** — desktop onboarding provisions the linux payload onto a user's server; the
   desktop app connects through an SSH tunnel.
3. **CLI / Claude Code** — an npm package (`vynel`) shipping only bundled dist: the thin CLI + the
   MCP stdio server Claude Code plugs into.

## Research: why bundle+minify, not bytecode or single-exe

| Option | Verdict |
|---|---|
| **esbuild bundle + minify, no sourcemaps** | ✅ CHOSEN. Industry standard (VS Code, Slack, Discord ship exactly this). All `@vynel/*` TS compiles into one `server.mjs`; names/structure destroyed by minification. Bonus: kills the tsx cold-start compile. |
| Ship TS + tsx (old plan) | ❌ Readable source on disk — the rejected approach. |
| `vercel/pkg` | ❌ Archived, dead. |
| Bun `--compile` single exe (what claude.exe is) | ❌ The exe is a self-extracting wrapper — the minified JS inside is extractable, so protection ≈ same as our bundle. Costs a runtime swap (Bun ≠ Node): agent SDK spawns `node` + needs real `node_modules` files anyway, better-sqlite3/onnx addon risk. All risk, no security gain. |
| Node SEA (single executable) | ❌ Cannot embed native addons (better-sqlite3, sqlite-vec); agent SDK spawns its CLI from real `node_modules` files. |
| bytenode (V8 bytecode) | ❌ v1. Node-version-locked `.jsc`, breaks `Function.prototype.toString`/arrow-function edge cases, strings (incl. prompts) stay readable anyway. Optional hardening later, on top of the bundle. |
| javascript-obfuscator on top | ❌ v1. Runtime cost + AV false-positive risk. Optional later if IP anxiety persists. |

**Honest security model (unchanged from D2 discussion):** minification raises the cloning bar from
"read it" to "reverse-engineer it" — it is deterrence, not cryptography. Anything genuinely worth
protecting (tiers, entitlements, marketplace, accounts) stays **server-side at the hub**, enforced
by signed tokens against a pinned public key. No secrets ever enter the payload.

## What stays external to the bundle (and why)

- **Third-party runtime deps** — installed as a pruned production `node_modules` from a *generated*
  package.json listing only third-party deps (no `@vynel/*` source ever lands in node_modules):
  `@anthropic-ai/claude-agent-sdk` (spawns its CLI from real files), `better-sqlite3`, `sqlite-vec`,
  `onnxruntime`/transformers, `ssh2`, `@napi-rs/keyring`, hono, etc.
- **Asset dirs shipped beside the bundle**, resolved through one path seam (`VYNEL_ASSETS_DIR` or
  exe-relative): `packages/db/src/migrations-sqlite/*.sql`, `packages/instructions/`
  (session-instructions / tool-descriptions / notebooks markdown), desktop-control's native loaders.
  The known file-readers: `db/src/index.ts`, `instructions/src/**/load-*.ts`, `desktop-control`.
- **Web UI** — `apps/local-web/dist` (Vite build, already minified).

## Phase A — the payload pipeline (foundation, everything depends on it)

New `scripts/src/release/`:

- **`build-payload.ts <target>`** (win-x64 | linux-x64 | linux-arm64):
  1. esbuild: entry `apps/local-api/src/server.ts`, `platform=node format=esm bundle minify`,
     externals = third-party deps → `payload/backend/dist/server.mjs`. No sourcemaps in payload
     (kept locally for our own crash decoding).
  2. Emit generated `package.json` (third-party runtime deps only) → `pnpm install --prod`
     with the target platform/arch flags for native prebuilds.
  3. Copy asset dirs + `apps/local-web/dist` → `payload/web`.
  4. Download + SHA-256-pin Node 22 for the target → `payload/node(.exe)`.
- **`verify-payload.ts`** — the gate: assert migrations count matches repo, native binaries present,
  agent-SDK CLI present, **no `.ts` and no `@vynel/*` directory anywhere in the payload**; then
  smoke-boot with the pinned node + absolute env paths into a temp dir, poll the port, hit routes
  (incl. one that runs a migration + one instructions read), kill. Measure size + cold-start.
- **Bundle-hazard fixes as they surface**: the static-specifier dynamic imports
  (`await import('@vynel/mcp')` etc.) bundle fine; any `import.meta.url`-relative asset read gets
  routed through the one asset-path seam. Fix at the source, one seam, not per-file hacks.

**Green =** verify-payload passes on win-x64 with the repo renamed away; linux payload built (smoke
in Phase D).

**PRUNE SLICE (2026-07-28): payload 861→511 MB, 16.4k→10.2k files** (`prune-payload.ts`: one onnx
platform binary instead of six, onnx-web/transformers reduced to their Node-condition entries,
pdf-parse test corpus, @types/zod-src, all .d.ts/.map). Installer 170→123 MB; clean install
663s→**102s**. Post-prune proof: verify asserts the kept entries; full embedding
download+inference run green on the staged runtime against the pruned tree.

**STATUS: BUILT + GREEN (2026-07-28).** Measured on win-x64: payload 861 MB installed (≈254 MB is
the agent SDK's native claude binary — the SDK ships per-platform Bun executables as optional deps
now, no cli.js; supportedArchitectures selects the right one per target), cold start **1.3s**
(28.9s on the very first boot at a fresh location — Defender scanning new files, a one-time
first-install tax). Verified green both in-repo and relocated outside the repo (`--dir=`).
Learnings folded in: the speak tool's markdown description loads at MODULE IMPORT time, so
server.ts became an import-light entry (env + content-root seam, then dynamic-import boot.ts);
third-party npm packages legitimately ship their own `.ts` (zod, onnxruntime) so the IP gate is
"no `.ts` outside node_modules + no @vynel dir"; payload installs use their own pnpm-workspace.yaml
(hoisted linker — flat npm-style tree, no .pnpm symlink forest for NSIS; per-target
supportedArchitectures; allowBuilds for native prebuilds).

## Phase B — desktop installer + auto-update (Windows first)

Carries forward the still-valid D2 decisions: bundled pinned `node.exe` · voice scoped out until the
updater is proven · GitHub releases (`vynel-releases` public repo, code private) first, hub
`ArtifactStore` endpoint flip later · unsigned for internal testing, Azure Artifact Signing
(~$10/mo) via `bundle.windows.signCommand` when public.

- **B1 — NSIS installer**: `tauri.conf.json` bundle active (nsis, per-user), externalBin node,
  resources = payload; `daemon.rs` bundled-mode resolution — exe-adjacent `resources/backend/dist`
  exists → spawn `node.exe dist/server.mjs` with absolute env paths (DB/models/web/assets in
  `app_data_dir`) + `VYNEL_APP_VERSION`; else the existing repo walk-up (dev workflow intact).
  Green = clean-VM install, onboard, chat; DB in Roaming; uninstall keeps user data.
- **B2 — lifecycle hardening**: single-instance plugin, file logging, kill-on-close Job Object
  (reaps the agent SDK's node subprocesses). Green = zero `node.exe` after close, mid-turn included.
- **B3 — auto-update**: `tauri-plugin-updater`, signer keypair (private key env-only, release script
  refuses if a key file is in-repo), `latest.json` + artifacts pushed to `vynel-releases` via `gh`,
  passive install mode. Green = 0.1.0 → 0.1.1 self-update on the VM.
  **DONE (2026-07-28): proven live — installed 0.1.0 prompted and self-updated to 0.1.1
  (`kafijunior/vynel-releases`). Publish = `pnpm release:desktop --publish` with
  `TAURI_SIGNING_PRIVATE_KEY` loaded. B1+B2+prune+B3 all landed; Phase B complete.**
- **B4 — hub serves releases** (when the hub deploys): `GET /releases/desktop/latest` off
  `ArtifactStore`; endpoint flip in `tauri.conf.json`.

## Phase C — CLI + Claude Code integration (npm, cheap, independent after A)

**STATUS: BUILT + VERIFIED (2026-07-28).** `pnpm release:cli` → `apps/cli/dist-npm/` (generated
whole: 155KB cli.mjs + 622KB mcp-server.mjs — the OpenAPI spec inlines — + launcher + manifest
with ZERO dependencies). `release:cli-verify` PASS: tarball source-free, offline --help, live CLI
round-trip, MCP stdio handshake listing all 84 tools against the installed daemon. Publish =
Chad: npm org `vynel` (scope unclaimed as of today) + `npm publish --access public` from
dist-npm.

- Publish **`@vynel/cli`** on npm (Chad's call, 2026-07-28; bin name stays `vynel`):
  `files: ["dist"]` only — esbuild-bundled minified CLI
  (`apps/cli`) + the **MCP stdio server** (`apps/mcp` external server) as a second bin
  (`vynel mcp`). No source, no workspace deps in the tarball (bundled in).
- Claude Code integration = `claude mcp add vynel -- npx -y vynel mcp` (docs + an onboarding
  snippet). The stdio server already relays to the daemon over HTTP — works against a local
  install *or* an SSH tunnel unchanged.
- Both bins talk HTTP to a running daemon (the CLI's existing contract); `--url` / env override
  for non-default ports.

## Phase D — SSH server install (the big new feature, last)

Desktop onboarding gains **"Where should Vynel's engine run?" — This computer | My server (SSH)**.

- **Provisioner** (new `packages/server-install` leaf, reusing the `ssh2` + sealing/keyring
  precedents from `packages/ssh-servers`): collect host/user/auth → TOFU host-key pin → upload the
  linux payload (or server-side `curl` from releases + SHA check) → install as a **systemd user
  service** → generate a per-install auth token (sealed locally) → health check.
- **Transport: plain HTTP, never public** (Chad's call, 2026-07-28: "we can use http"). The remote
  daemon binds `127.0.0.1` only — the provisioner verifies no public exposure. The desktop reaches
  it through an **SSH local port forward** using the same credentials provisioning already holds;
  the shell supervises/reconnects the tunnel alongside the daemon lifecycle it already owns. The
  app talks plain HTTP to `localhost:<forwarded>`; the wire is encrypted by SSH. No certs, no
  public port, no TLS code anywhere. A per-install bearer token still gates the daemon in remote
  mode (defense against other local users on a shared server).
- **Server-side Claude runtime**: the agent SDK on the server needs Claude Code auth there —
  onboarding step that runs `claude setup-token` through the tunnel/terminal, or copies a
  long-lived token the user creates. Must be designed with the onboarding wizard.
- **Updates**: desktop-driven — on app update (or user click), the provisioner re-ships the payload
  version matching the shell, restarts the service. Version handshake on connect (the D2 risk #4,
  now load-bearing: shell and remote daemon can genuinely drift).
- Voice + desktop-control tools are local-machine features — capability-gated off for remote
  engines in v1.

## Decisions (Chad, 2026-07-28)

1. **Protection level** — minified bundle only; obfuscator/bytenode revisited only on real-world
   signal.
2. **Remote transport** — **plain HTTP over an SSH port forward** (revised from HTTPS same day:
   "we can use http"). Daemon localhost-only on the server; SSH tunnel carries the wire; bearer
   token gates remote mode. Raw HTTP on a public port was ruled out — cleartext token + content
   would let an on-path attacker drive the agent. No TLS work anywhere in the plan.
3. **npm name** — `@vynel/cli` (scoped), bin `vynel`.
4. **Phase order** — A → B → C → D as recommended.

## Risks

1. **Bundle-time unknowns** — some dep or pattern that resists bundling (worker threads, eval'd
   code). Mitigation: Phase A's smoke-boot is the very first deliverable; anything unbundleable
   moves to the externals list (worst case for IP: one more third-party dep external — ours all
   bundle, they're plain TS).
2. **Cross-platform native prebuilds** — linux better-sqlite3/onnx prebuilds fetched from a Windows
   build machine (`--target-platform` install flags); verify early in Phase A, else build in CI on a
   linux runner.
3. **Payload size / MAX_PATH** — transformers+onnx dominate (~500MB+ installed); measured in A.
   Bundling removes the deep `.pnpm` source tree, which also shrinks NSIS MAX_PATH exposure.
4. **Server heterogeneity (Phase D)** — distro/arch/systemd variance; v1 constrains to
   x64/arm64 glibc distros with systemd, checked by the provisioner before install.
