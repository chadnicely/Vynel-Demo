# Server install (Phase D) — module notes

**Status:** shape surveyed 2026-07-28 · forks ANSWERED by Chad same day (see below) · implements
`docs/release-plan.md` Phase D (SSH server install, the last release-plan phase).

## Chad's fork answers (2026-07-28)

1. **Bootstrap = local-first + restart.** The local engine always onboards first; choosing
   "my server" provisions from the running local daemon, persists the choice where the shell
   reads it pre-boot, and applies on app restart (the updater's restart muscle).
2. **Tunnel = node + ssh2, bundled in the payload.** Local HTTP listener on 8998 forwarding
   over ssh2 `forwardOut`, injecting the bearer header — web UI/SDK unchanged, credentials
   stay sealed, supervised exactly like the daemon child.
3. **Verification = WSL2 (systemd + sshd) for D0/D1 smoke, a real VPS for final E2E.**

## Locked upstream (release-plan decisions, 2026-07-28)

- Transport = **plain HTTP over an SSH local port forward**. Remote daemon binds `127.0.0.1`
  only; the SSH tunnel carries the wire; a per-install bearer token gates the daemon against
  other local users on a shared server. No TLS anywhere.
- New **`packages/server-install`** leaf, reusing `packages/ssh-servers` precedents (ssh2,
  TOFU pinning, sealing/keyring).
- Install as a **systemd user service**; v1 constrained to x64/arm64 **glibc** distros with
  systemd (provisioner checks before installing).
- Voice + desktop-control are local-machine features — off for remote engines in v1.
- Updates are desktop-driven: re-ship the payload matching the shell version; version
  handshake on connect.

## What the survey established (2026-07-28)

### Honest correction: the linux payload was never built

Phase A's green criterion claimed "linux payload built (smoke in Phase D)" — it was not, and
`build-payload.ts linux-x64` is broken today:

- `pnpm install --prod` runs bare — `supportedArchitectures` selects *optional-dep* platform
  packages, but install *scripts* (`better-sqlite3`: `prebuild-install || node-gyp rebuild`)
  resolve against the **host** platform → a win32 `better_sqlite3.node` would land in a linux
  payload, and `verify-payload` (existence check only) would pass it.
- No `libc:` key in the generated workspace file — several deps ship gnu *and* musl variants
  (`@napi-rs/keyring`); v1 is glibc-only, so pin `libc: ["glibc"]`.
- `notification-listener.ps1` is copied + asserted unconditionally (Windows-only artifact).
- Smoke boot is gated `target.os === 'win32' && process.platform === 'win32'`.
- No archive step exists anywhere; exec bits (staged `node`, the agent SDK's native `claude`
  binary) don't survive NTFS — the tarball step must set modes explicitly.

### Headless-boot blocker: the keyring

`apps/local-api/src/boot.ts` unconditionally calls
`resolveMasterKey(createKeyringMasterKeyVault())` before `serve()`. On a headless linux
server (no DBus session / Secret Service) the first-use `setPassword` **throws uncaught and
boot dies**. Needs a file-based master-key vault for server mode (the `MasterKeyVault` seam
in `packages/ssh-servers/src/sealing/master-key.ts` already exists for exactly this).

### Confirmed negatives (net-new work, not reuse)

- **No inbound auth anywhere in local-api** — loopback bind is the entire security model.
  The bearer token (env `VYNEL_AUTH_TOKEN`-shaped, gateway middleware) is greenfield.
- **No SSH/tunnel code in the Tauri shell** (`Cargo.toml` has no ssh dep); `ssh-servers` has
  no port forwarding, no SFTP, no pool — all deferred-by-design in v1 (`ssh.md`). Phase D
  reverses those deferrals inside the new leaf, not inside `ssh-servers`.
- **No writable desktop config surface** — nothing writes `<app_data>/config.env`; no
  tauri-plugin-store; the shell's only IPC commands are `browser::*`.
- **No branching mechanism in onboarding** — `getNextOnboardingStep` is `order + 1`;
  `isSkippable` is a user-facing skip. An engine-choice step follows the `optional-channel`
  precedent: ONE step, discriminated-union input (`this-computer | my-server{...}`).

### Reuse map (what carries over)

- `executeSshCommand` connect-options + TOFU `hostVerifier` + settle/timeout discipline
  (`packages/ssh-servers/src/connecting/execute-ssh-command.ts`). NOTE fingerprint format is
  raw base64 sha256, NOT OpenSSH's `SHA256:`-prefixed form — matters if shown to users.
- Sealing: `sealSecret`/`openSecret` + the `MasterKeyVault` seam; hub-account's
  parameterized `createKeyringVault(entryName)` is the more extensible keyring pattern.
- `startFakeSshServer` test harness (real ssh2 loopback server) — extend for key auth + SFTP.
- The shell's process supervision is mode-agnostic: `LaunchPlan` gains a `Remote` arm and
  the existing spawn/Job-Object/watch loop supervises a tunnel child unchanged. Port 8998 is
  hardcoded in five places — a `remote:8998 → 127.0.0.1:8998` forward leaves ALL untouched.
- `ssh_servers` schema/sealing precedent for credential rows; next migration number **0022**.
- Desktop-control gates itself off on linux remotes for free (`resolveDesktopOs()` guard →
  descriptor `build()` returns null). Voice needs explicit gating (loopback default URL would
  resolve to the SERVER's loopback — wrong machine).
- systemd env contract = the nine smoke-boot vars (verify-payload) minus `SystemRoot`, plus
  `HOME`, real `PATH`, `VYNEL_APP_VERSION`, `VYNEL_AUTH_TOKEN`, the file-vault flag; reuse
  node's `--env-file-if-exists` layering exactly as `daemon.rs` does.

## Slice plan (one move at a time, gate-green each)

- **D0 — linux payload real** (BUILT 2026-07-28, see learnings below): cross-install native
  deps for linux targets, per-target artifact skip (`.ps1`), per-target verify (magic-byte
  format asserts, not existence-only), smoke boot in WSL. The file-based master-key vault
  moved INTO this slice from D1 — it's the smoke's dependency (headless keyring crash).
  Tarball step deferred to D5 (the release artifact needs it; the smoke doesn't — /mnt
  drvfs mounts files 0777 so the staged node runs without a chmod; D2's provisioner
  restores exec bits server-side).
- **D1 — headless boot + bearer** (BUILT 2026-07-28): `/health` on the gateway (always
  open — liveness + version for the D5 handshake and the D2 probe), `VYNEL_AUTH_TOKEN`
  bearer gate on every other surface (timing-safe compare; 401 with an actionable message),
  `VYNEL_REMOTE_ENGINE` flag riding the createApp-options seam (the desktopActionsEnabled
  precedent) — `speak` answers "voice lives on the desktop" without probing the server's own
  loopback. PROVEN LIVE on the linux payload in WSL: /health open + stamped version,
  401 bare, 412 (onboarding gate) with the correct bearer — auth passed, app reached.
  Narrowing taken: the speak TOOL still appears in the remote engine's tool list (the
  route answers honestly; suppressing it from the generated registry needs a composer-level
  engine-facts seam — deferred to D3/D4 where remote runtime wiring lands).
- **D2 — `packages/server-install` leaf**: provisioner ops — preflight (arch/glibc/systemd
  check), SFTP upload (or server-side `curl` + SHA from the release), systemd user unit
  install (`loginctl enable-linger`), token mint + seal, health check via remote exec. Own
  schema (0022), routes, onboarding-deps binding. Green = provisions a real server end-to-end
  from a test.
- **D3 — tunnel runtime + `LaunchPlan::Remote`**: the tunnel child the shell supervises +
  the shell-readable engine-location config in `app_data`. Green = installed desktop app in
  remote mode round-trips chat through the tunnel.
- **D4 — onboarding step + settings surface**: "Where should Vynel's engine run?" step
  (union input, `optional-channel` precedent) + a settings section for switching later;
  server-side Claude auth walkthrough (`claude setup-token` via remote exec) designed into
  the wizard step. Restart applies the switch.
- **D5 — updates**: version handshake on connect → provisioner re-ships on drift; linux
  payload tarball rides the same `vynel-releases` gh release as the desktop artifacts.

## FORKS FOR CHAD (blocking)

1. **Bootstrap shape** — all UI is served by the daemon, and the engine choice lives in the
   DB the daemon owns, so the wizard can't ask "where should the engine run?" unless a local
   daemon is already running. (a) Local engine always onboards first; choosing "my server"
   provisions from the running local daemon, persists the choice where the SHELL reads it
   pre-boot, and applies on restart (the updater already restarts the app — same muscle).
   (b) A pre-daemon native chooser in the shell. (c) Remote mode keeps a thin local daemon as
   a UI proxy. **Recommendation: (a)** — smallest structural change, matches the updater
   restart precedent, and the local engine is useful during provisioning anyway.
2. **Tunnel implementation** — (a) a small tunnel entry bundled into the payload (node +
   ssh2: local HTTP listener on 8998 forwarding over `forwardOut`, injecting the bearer
   header so web/SDK need ZERO changes; unseals credentials via the existing keyring path;
   supervised exactly like the daemon child). (b) Shell out to Windows' bundled `ssh.exe`
   (needs a plaintext key file + OpenSSH-format known_hosts on disk; cannot inject the
   bearer, so the token needs another carrier). (c) A Rust SSH crate in the shell (new heavy
   dep in a deliberately thin 793-line shell). **Recommendation: (a)** — reuses our sealed
   credentials, our TOFU pin, our supervision, and keeps the bearer invisible to the UI.
3. **Linux verification target** — D0's smoke and D2's end-to-end need a real linux+systemd
   machine. Real VPS of Chad's? WSL2 (systemd+sshd enabled) for the early slices with a VPS
   for final E2E? Fresh rented VM?

## D0 learnings (2026-07-28)

- **pnpm's side-effects cache poisons cross-builds** — it replays install-script output
  keyed by the HOST, so the linux install received the win32 `better_sqlite3.node` the
  desktop build had compiled, and skipped the install script even with
  `sideEffectsCache: false` in the generated workspace file. The fix is defense in depth:
  cache off + an explicit `repairCrossBuiltNatives` step (runs `prebuild-install
  --platform --arch` for any prebuild-install dep whose shipped binary fails the
  magic-byte check) + the post-prune sweep failing the build on any surviving foreign
  REQUIRED native.
- **`supportedArchitectures` filters optional deps only.** Two leak classes found:
  nut-js's three libnut platform packages are REGULAR deps (all three installed
  everywhere — was riding the win payload too); the agent SDK's `-musl` platform package
  declares no `libc` field so the glibc pin can't exclude it (258 MB of Alpine binary).
  Both are now per-target prune rules.
- **Host-compiled optional accelerators** (`cpu-features`, ssh2's `sshcrypto.node`) always
  build for the host via node-gyp; in a cross-build the sweep deletes them (pure-JS
  fallbacks take over on the server).
- **bsdtar treats `E:\...` as a remote host** (colon = ssh separator) — the node-runtime
  tar extraction runs with cwd = cache dir and relative paths.
- **WSL smoke works end-to-end**: Debian (glibc 2.41, systemd PID 1), payload on /mnt
  (9p — cold start 16s vs 1.3s native; deadline 300s), DB/home/key on WSL-native /tmp,
  polled from the Windows side (the localhost relay does surface a 127.0.0.1-bound WSL
  service; an in-WSL fallback probe disambiguates if not). `verify-payload linux-x64
  --wsl=Debian`.
- Output layout: linux payloads assemble to `dist-payloads/<target>/` (gitignored) — the
  tauri payload dir stays exclusively win-x64 so a server build never clobbers the
  installer's staged resources.
- Payload sizes: win-x64 510 MB / linux-x64 587 MB (post-musl-prune; linux ELF binaries
  run larger).

## Deferred (deliberate, v1)

- musl/Alpine support · non-systemd distros · multi-server / server switching UI beyond one
  active remote engine · voice-on-remote · Windows-server remotes (desktop-control gating
  assumes linux) · hub-served payload downloads (B4 ties in later).
