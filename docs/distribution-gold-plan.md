# Vynel — gold distribution plan (Windows)

**Status:** proposed 2026-08-09 · extends `docs/release-plan.md` Phase B (B1–B3 shipped and proven;
this plan is the gold layer on top, and absorbs B4).

## Where we stand vs the benchmark (inspected live on this machine)

| | Install location | Root contents | Installer UX | Signed |
|---|---|---|---|---|
| **Telegram** | `%APPDATA%\Telegram Desktop` (Roaming — and it mixes `tdata` user data into the program dir) | `Telegram.exe` (213 MB native C++), `Updater.exe`, Inno uninstaller | minimal Inno wizard | yes |
| **Discord** | `%LOCALAPPDATA%\Discord` | `Update.exe` + versioned `app-1.0.9251\` full of ~25 loose DLLs + extractable `resources\app.asar` | Squirrel one-click splash | yes |
| **VS Code** | `%LOCALAPPDATA%\Programs\Microsoft VS Code` (user setup default) | `Code.exe` + plain readable JS under `resources\app\out` | full Inno wizard | yes |
| **Vynel today** | `%LOCALAPPDATA%\Vynel` | `vynel-desktop.exe`, `node.exe`, `uninstall.exe`, `resources\{backend,web}` | stock NSIS wizard, unbranded | **no** |

**The verdict:** our location and skeleton are already industry-correct — every consumer app chose
per-user, no-elevation AppData installs, because Program Files kills self-update (Slack's
machine-wide MSI explicitly disables auto-update; VS Code's system setup needs elevation per
update). Nobody hides their JS — Discord/Slack/VS Code all ship extractable source; they **sign**
it. Telegram only *looks* opaque because it is native C++. What separates us from gold is:
naming, Authenticode signing, installer branding, and the update experience. Not the architecture.

## 1 · The gold install layout

```
%LOCALAPPDATA%\Vynel\
  Vynel.exe                ← the shell (renamed via mainBinaryName; Authenticode-signed)
  uninstall.exe            ← NSIS uninstaller (signed)
  resources\
    engine\                ← was resources\backend
      vynel-engine.exe     ← node.exe, renamed + rebranded (see below); plain resource,
      dist\                   not externalBin — daemon.rs spawns by path anyway
        server.mjs
        tunnel.mjs
        notification-listener.ps1
      node_modules\        ← third-party only, pruned (unavoidable and industry-normal:
      assets\                 VS Code ships the same thing in the open)
      package.json
    ui\                    ← was resources\web

%APPDATA%\Vynel\           ← user data home (was %APPDATA%\app.vynel.desktop) — FORK 1
  data\vynel.db
  logs\
  models\
  config.env / engine.json
```

Root goes from 4 entries with a dev-smelling exe name to **two signed executables and one
folder** — tighter than Discord's root. Changes required:

- `mainBinaryName: "Vynel"` in tauri conf (installed exe + NSIS kill-list name).
- Resources remap in `tauri.release.conf.json`: `payload/backend → resources/engine`,
  `payload/web → resources/ui`, `payload/node.exe → resources/engine/node.exe`; drop
  `externalBin`. `daemon.rs` path updates follow.
- **Data home (FORK 1):** `app.vynel.desktop` is a correct Tauri identifier but an ugly folder a
  non-technical user will meet in Roaming. Recommendation: keep the identifier (updater +
  single-instance continuity) but point daemon paths at `%APPDATA%\Vynel`, with a one-shot
  move-migration from the old dir, log-plugin dir override, and an uninstaller hook so the
  "delete app data" checkbox removes the new home too. Pre-public is the only cheap moment.
- **Migration check (must VM-test):** updating a `vynel-desktop.exe`-era install to the renamed
  exe — the updater flow exits the app itself first, but we must verify the old exe file is
  removed and no stale root files remain.

### The engine executable (why users never see "node.exe")

`node.exe` is visible in three places: the install dir (fixed by the move above), **Task
Manager** — where non-technical users today see a mystery "Node.js: Server-side JavaScript"
process — and AV/permission dialogs. The fix is the Discord/Electron playbook (Discord.exe is a
renamed, re-resourced, re-signed Electron):

1. **Rename** to `vynel-engine.exe` (G1). A plain rename keeps the OpenJS Authenticode signature
   valid — signatures cover content, not filename. `stagedNodeName` in `payload-targets.ts` is
   the existing seam; `daemon.rs` spawns by explicit path.
2. **Rebrand the version resource** via rcedit — FileDescription "Vynel Engine", product
   name/version, Vynel icon; that string is what Task Manager displays. Editing resources
   invalidates the OpenJS signature, so this step lands with G2 and the binary is **re-signed
   with the Vynel certificate** in the same build. End state: Task Manager shows "Vynel Engine",
   signed by Vynel.
3. **Not doing: embedding `server.mjs` into the exe** (Node SEA / Bun compile — already rejected
   in release-plan.md): our bundle is ESM (SEA takes CJS only), native addons can't embed, the
   agent SDK spawns its CLI from real files — so `node_modules\` stays on disk regardless, and
   packing a ~500 KB mjs while 500 MB of deps sit beside it hides nothing. Self-extracting exes
   unpack trivially anyway. Minified `dist\` beside a branded engine exe is the VS Code layout.

VM smoke must confirm nothing assumes the runtime's basename is `node` (SDK subprocess spawns go
through `process.execPath`, which follows the rename).

## 2 · The installer

Two levels; recommendation is A now, B optional later — FORK 2.

**A. Branded minimal wizard (Telegram-class, recommended).** Tauri's stock NSIS template with:
`installerIcon`/`uninstallerIcon` (.ico), `headerImage` (150×57 BMP), `sidebarImage` (164×314 BMP
on Welcome/Finish), no license page, English + `languages` later. Pages: Welcome → Directory →
Start Menu → Install → Finish. Cheap — config plus three brand assets.

**B. One-click (Discord-class).** Tauri has no `oneClick` toggle; it requires overriding the full
NSIS `template` (~1000 lines we then maintain across Tauri upgrades). The passive-mode skip logic
in the stock template does most of the work, but this is a fork we own forever. Defer until the
brand justifies it.

Plus, either way:
- `webviewInstallMode: embedBootstrapper` (+1.8 MB) — install works without hitting Microsoft's
  CDN mid-setup.
- Uninstall keeps user data by default; the built-in checkbox (plus our hook for `%APPDATA%\Vynel`)
  offers full removal. Matches B1's "uninstall keeps user data" green criterion.

## 3 · Signing & trust (the actual "secure")

**This is the gap that makes today's build feel untrustworthy** — unsigned installers get
"Windows protected your PC" on every user's machine and Smart App Control on Win 11 can block
them outright.

- **Primary path: Azure Artifact Signing** (renamed from Trusted Signing; GA Jan 2026) — **Basic
  $9.99/mo**, 5,000 signatures/mo. Individuals must be US/Canada-located (validated against the
  Azure billing account + government ID); orgs: US/CA/EU/UK/AU/JP/++. Issues short-lived (~72 h)
  Microsoft-chained certs with a durable identity EKU — community experience is near-instant
  SmartScreen reputation, though Microsoft only commits to "accrues over time". Never delete or
  recreate the identity validation / certificate profile — it is the reputation anchor.
- **Fallback if AAS eligibility fails: Certum Open Source** (€69 first year / €29 renewal,
  individual-friendly, cloud signing available). Reputation accrues like any OV cert.
- **EV is dead weight** — Microsoft removed EV's instant-reputation bypass in 2024 and says so in
  its own docs. Do not buy one.
- **Pipeline:** `bundle.windows.signCommand` → `artifact-signing-cli` (renamed from
  `trusted-signing-cli`). Tauri then signs the main exe, the NSIS installer **and** the
  uninstaller in one pass, and skips already-signed binaries (node.exe keeps its OpenJS
  signature). Credentials via `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_CLIENT_SECRET` env —
  same env-only discipline as the minisign key. ~4 signatures per release; quota is a non-issue.
- **Minisign key hygiene (do regardless):** the updater private key must be password-protected,
  live only as an env/CI secret — STATE.md records a copy sitting in a scratchpad dir; that gets
  deleted. Rotation exists if ever leaked: ship a transition release signed with the old key
  carrying the new pubkey. Known leak class to keep audited: never allow `TAURI_` into any
  frontend env allowlist (CVE-2023-46115).
- **Honest model (unchanged from release-plan):** per-user installs are user-writable — signing
  proves origin and gates SmartScreen; it does not stop a local process from patching files.
  True tamper-proofing is Store/MSIX territory (maybe someday, not now). Source stays
  minified-not-hidden; anything valuable stays server-side at the hub.

## 4 · The update experience

Consensus gold UX (Telegram/Discord/Chrome/VS Code all converge): **silent background download →
unobtrusive "restart to update" → apply near-instantly on relaunch.** Never a modal, never a
wizard.

Current state: startup check → native OK/Cancel dialog → download → passive NSIS → relaunch.
Functional (proven 0.1.0→0.1.1) but the dialog is a modal interruption. Gold flow:

1. **Check** on startup + every ~4 h, silent.
2. **Download in the background** with in-app progress (the updater's Started/Progress/Finished
   events feed the shell UI via Tauri events — no dialog).
3. **"Update ready — Restart"** pill in the shell; user restarts when they choose. (On Windows
   the install step always exits the app — that's a platform constraint; deferring is ours.)
4. **Quiesce before exit:** `on_before_exit` → graceful daemon stop (bounded wait; ask the engine
   to WAL-checkpoint + close the DB), Job Object as the hard backstop. NSIS only kills
   `Vynel.exe` by name — the daemon is entirely our responsibility, and an orphaned engine
   running old code against a newly-migrated DB is the real hazard, not file locks (DB lives in
   Roaming, outside the install dir).
5. **Passive install** (small progress window, honest) → auto-relaunch. `quiet` works for
   per-user installs but makes the restart feel mysterious; passive is the recommendation.
6. **First boot after update:** back up `vynel.db` before running migrations (copy, keep last
   one) — migrations are the only non-rollbackable step. Ties into the planned move to
   incremental migrations.

**Size reality:** Tauri has no delta updates — every update re-downloads the full ~123 MB
installer (LZMA already on). Discord-style deltas would mean replatforming the whole
bundler+updater onto Velopack (mature, has a Rust crate, but replaces NSIS/minisign/latest.json
wholesale and has no proven Tauri integration). **Not recommended now**; revisit only on real
user pain. Known Tauri pitfall to guard in CI: stale sidecar/build-cache not replaced on update
(tauri#15134) — our `release:verify` + wiped bundle dir already cover most of it.

**Rollback:** NSIS overwrites in place, no automatic rollback. Mitigations: old installers stay
downloadable on GitHub releases; once the hub serves manifests it can point clients at N-1; DB
backup covers the data side.

**Distribution service (absorbs B4):** move the updater `endpoints` to the hub —
`GET /releases/desktop/{{target}}/{{arch}}/{{current_version}}` returning the manifest or HTTP
204 (no update) — with the GitHub `latest.json` URL kept as fallback entry #2 in the endpoints
array. This is what unlocks, server-side and without touching shipped clients: release channels
(stable/beta), percentage staged rollouts, and rollback pointers. Artifacts themselves stay on
GitHub releases (hub redirects), so bandwidth stays free.

## 5 · Deliberately not doing

- **Program Files / perMachine** — breaks silent self-update (the Slack/VS Code evidence);
  per-user is what every consumer app chose.
- **Hiding source beyond minification** — settled in release-plan; industry norm is sign-not-hide.
- **Velopack replatform** — deltas + 2s applies are real, but it swaps out the proven
  NSIS+minisign pipeline for an unproven seam. Revisit on signal.
- **MSIX / Microsoft Store** — the only true tamper-proof channel; heavyweight; someday, not now.
- ~~**Voice packaging** — still out of scope~~ — SHIPPED 2026-08-22 as a second sidecar of the
  win-x64 payload (`dist/voice.mjs` + sherpa-onnx/node-cpal natives, ~22 MB; `voice_sidecar.rs`,
  boots idle until Settings → Voice downloads a model). Call cables stay out of the installer.

## 6 · Phases

**G1 — identity & layout** (no new infra): `mainBinaryName`, resources remap
(`engine`/`ui`), node.exe → `resources\engine\vynel-engine.exe` (rename only, signature-safe),
data home move + migration (pending FORK 1), installer branding assets, `embedBootstrapper`,
uninstaller data hook.
*Green:* clean-VM install shows the gold tree; update from 0.1.1 leaves zero stale files;
uninstall keeps data / checkbox removes all; **`@vynel/cli` + the MCP stdio server still work
against the installed engine** (`vynel` round-trip + MCP handshake on 18892 — the CLI talks HTTP
to the daemon, so every layout/rename change must leave that contract untouched; `release:cli-verify`
runs as part of the gate).

**G2 — signing**: AAS account (or Certum), `artifact-signing-cli` + `signCommand` in the release
conf, env-only credentials; rcedit rebrand of `vynel-engine.exe` ("Vynel Engine" in Task
Manager) + re-sign it with the Vynel cert; minisign key password + scratchpad copy deleted;
rotation runbook documented.

*Seam BUILT (2026-08-09), credential-gated in `build-desktop.ts`:* set ALL of
`VYNEL_SIGN_ENDPOINT` / `VYNEL_SIGN_ACCOUNT` / `VYNEL_SIGN_PROFILE` +
`AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET` and the build signs everything
(Vynel.exe + installer + uninstaller via a generated signing overlay config; the engine exe is
rcedit-rebranded and signed by the script itself, since Tauri never signs resources). No signing
env → unsigned build, engine keeps its valid OpenJS signature (rcedit skipped). Partial env →
loud failure. Activation = create the AAS account, `cargo install artifact-signing-cli`, load the
six values. *Key hygiene verified 2026-08-09:* the minisign updater key lives at
`C:\Users\KLONE\.vynel-keys\vynel-updater.key` (out of repo and Temp; the old scratchpad copy is
gone); a test signature's key ID matches the baked pubkey (`b6821acc18524268`), so it IS the
production key — never regenerate it. It carries **no password** — acceptable for the test phase;
add one (or rotate to a passworded key via the update chain) before going public. Nothing in git
history. Release build — BOTH vars, always:
```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\KLONE\.vynel-keys\vynel-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""   # REQUIRED even though the key has no password:
pnpm release:desktop                            # unset, the tauri CLI PROMPTS on stdin and a
                                                # non-interactive build hangs forever after NSIS
                                                # (bit us on the first 0.2.0 build, 2026-08-09)
```
*Green:* installer/exe/uninstaller show valid signatures on the VM; SmartScreen shows publisher
name, no "unknown publisher".

**G3 — update experience**: background download + in-app progress events, restart-pill in the
shell UI, `on_before_exit` daemon quiesce, DB backup pre-migration.
*Green:* live 0.x→0.y update on the VM with the new UX, engine down before install, DB backup
present, zero orphan engine process.

*BUILT (2026-08-09):* `updater.rs` = silent check on launch + every 4 h → background
`download()` with `vynel://update-progress` events → parked in memory + `vynel://update-ready` →
`UpdatePill.vue` (bottom-right, never modal) → `updater_install_now` command →
`on_before_exit` stops the engine → passive NSIS + auto-relaunch. DB backup =
`backupBeforePendingMigrations` in `@vynel/db` (VACUUM INTO snapshot, only when a migrated DB
faces pending migrations; 5 tests) wired into local-api boot.

**G4 — distribution service**: hub manifest endpoint (204 semantics, channel param, rollout %,
rollback pointer), endpoints array flip with GitHub fallback.
*Green:* update served through the hub on the VM; GitHub fallback proven by killing the hub.

*Client side BUILT (2026-08-09):* a hub-configured build (`VYNEL_HUB_URL` set) bakes
`{hub}/releases/desktop/{{target}}/{{arch}}/{{current_version}}` as endpoint #1 with the GitHub
`latest.json` as fallback #2, via a generated overlay in `build-desktop.ts` — no manual config
flip ever. Hub-less builds stay GitHub-only.

## VM verification checklist (Chad — after `pnpm release:desktop`)

1. **Fresh install**: run the setup exe — expect NO wizard, just the progress window, then Vynel
   launches itself. Desktop + Start Menu shortcuts exist.
2. **Layout**: `%LOCALAPPDATA%\Vynel` contains exactly `Vynel.exe`, `uninstall.exe`,
   `resources\engine\` (with `vynel-engine.exe` inside) and `resources\ui\`. Nothing named
   node/backend/web anywhere.
3. **Task Manager**: while chatting, the engine process shows as `vynel-engine.exe` (after G2
   signing activation it will read "Vynel Engine").
4. **Data home**: DB/logs/models under `%APPDATA%\Vynel` (a pre-existing
   `%APPDATA%\app.vynel.desktop` gets renamed on first boot — verify old data survives).
5. **Update path**: install 0.1.1 first, onboard, then run the 0.2.0 setup — expect the old
   layout cleaned (no root `node.exe`, no `resources\backend`), data intact, `vynel-desktop.exe`
   gone.
6. **Self-update**: publish 0.2.0 + a 0.2.1, install 0.2.0 → pill appears after the background
   download → Restart → new version comes back, engine down during install (no orphan process),
   `vynel.db.pre-migration.bak` beside the DB if 0.2.1 carried a migration.
7. **CLI contract**: with the installed app running, `pnpm release:cli-verify` passes (CLI
   round-trip + MCP handshake on 18892).
8. **Uninstall**: keeps `%APPDATA%\Vynel` by default; re-run with the checkbox ticked → data home
   gone too.

Order: G1 → G2 ship together in one release ideally (one migration moment for users); G3, G4
independent after.

## Decisions (Kafi, 2026-08-09 — working the arc on Chad's account)

1. **Data home** — MOVE to `%APPDATA%\Vynel` (one-shot migration on first boot; identifier stays
   `app.vynel.desktop` internally).
2. **Installer level** — **one-click custom NSIS template now** (Discord-class, no wizard); we
   own the template fork across Tauri upgrades.
3. **Signing** — DEFERRED until after the demo/test phase (Kafi, 2026-08-09). Test builds ship
   unsigned; testers click through SmartScreen ("More info → Run anyway") — accepted. The
   minisign updater signing stays always-on. Provider locked: **Azure Artifact Signing** —
   Chad (the boss, US-based) handles the identity verification post-demo.
   **Activation runbook (Chad, ~$9.99/mo):** (1) Azure account with pay-as-you-go billing whose
   name matches a government ID → apply for Artifact Signing Basic → ID verification (takes
   days); (2) create the signing account + a Public Trust certificate profile (pick a region,
   e.g. EastUS → endpoint `https://eus.codesigning.azure.net`); (3) app registration with the
   "Artifact Signing Certificate Profile Signer" role → client id/secret/tenant; (4) build
   machine: `cargo install artifact-signing-cli`; (5) load the six env vars from §G2 —
   `pnpm release:desktop` then signs everything automatically. NEVER delete/recreate the
   identity validation or certificate profile once live — it anchors SmartScreen reputation.
4. **G4** — build now; Chad prepares the server. Hub endpoint + endpoints-array flip in this arc.
5. **CLI must keep working** — `@vynel/cli` + MCP stdio talk HTTP to `localhost:18892`; every
   green gate includes `release:cli-verify` against the installed engine.
