# Cloud API ("the hub") — discovery: auth · access tiers · marketplace · updates — plus the desktop-app track

**Status: DISCOVERY (2026-07-10). Nothing built. Chad resolved the forks same day (§9):
D1-desktop-shell-first · email+password sign-in · accounts provisioned by Chad's own platform via
WEBHOOKS (user create/update/remove + tier update; platform also handles all payments) · Postgres
from day one · hosting = Chad's own servers (Docker image, deploy when complete) · session
lifetime = log-in-once via a ~1-year rotating refresh token, revocation enforced by a boot-time
account-status check (§3/§4 — the signed JWT itself stays short-lived). Open before milestone 3:
tier matrix (§9-E) + the platform's payload/signing details (§9-H). Open before milestone 5:
Node runtime packaging (§9-F).**

This is the net-new surface `docs/vision.md` §9 names ("the cloud marketplace backend") plus the
account/tier layer it needs. It is **not** Phase 2 (Phase 2 = the *user's own data* moving to
Postgres/cloud sync). This service holds **our** data: accounts, entitlements, and the curated
catalog. It is, however, deliberate groundwork Phase 2 reuses (the account + auth layer).

The ask (Chad, 2026-07-10):

1. A hosted API the desktop app authenticates to; **access tier decides which features a user gets**.
2. The **real marketplace data holder** — skills, agents, MCPs, rules (later plugins) that users
   browse and install through the desktop app.
3. **Get to a real desktop app** — there is no installable app yet, only `pnpm dev` + the Tauri
   overlay window.
4. Security: nobody uses the app's paid features without our permission.
5. Business model: we run workspaces/teach people to use AI; **users purchase their own Claude
   subscription** (vision non-goal: never resell models — Vynel never sits in the Anthropic path).

---

## 1. Two tracks, one meeting point

- **Track A — the hub** (`apps/cloud-api`): a small hosted Hono service. Owns accounts, sessions,
  entitlements, the marketplace registry, and (later) app-release manifests for the auto-updater.
- **Track B — the real desktop app** (`apps/desktop` grows up): the Tauri shell gains the main
  window hosting the real UI, spawns the daemon as a sidecar, gets an installer, then auto-update.

They meet in three places: a **sign-in step** in the existing onboarding wizard, the **entitlement
token** the daemon checks before enabling gated features, and the **catalog fetch** that feeds the
marketplace section. Track B milestone D1 (see §7) has **zero cloud dependency** — the two tracks
can proceed in either order.

## 2. Shape in the repo

**Same monorepo, second system.** The hub shares the wire contracts with the desktop — that is the
whole argument for co-location: `MarketplaceItem`, the entitlement shape, and the auth DTOs live in
`@vynel/contracts` once, and the desktop client + hub routes can never drift. It also reuses
`@vynel/errors`, `@vynel/logger`, `@vynel/testing`, and the house route/test discipline.

```
apps/cloud-api/            # thin Hono adapter (parse → validate → call core → shape), env.ts (Zod)
packages/cloud-db/         # the hub's OWN kernel: schema + repositories (separate DB by design —
                           #   this is server-side truth, not the user's local data; invariant #3
                           #   "one shared @vynel/db" governs the PRODUCT monolith, not this system)
packages/accounts/         # leaf: sign-in (OTP), sessions/refresh, devices, entitlements, plans
packages/registry/         # leaf: catalog items, versions, artifact metadata, publish validation
```

Leaves follow the house shape: functional repositories (`db` first arg), typed `VynelError`
subclasses, one fluent Hono chain per route file, colocated tests. The product's `@vynel/db` is
**never** imported by the hub, and nothing under `apps/cloud-api` is imported by the desktop —
they talk over HTTP through `@vynel/contracts` types only.

**DECIDED (Chad, 2026-07-10): Postgres (Neon) from day one.** This makes the letterman notes in
`docs/module-notes/postgres-phase2.md` **actionable now for the hub**: pooled/direct URL split
(migrations bypass the pooler), explicit `prepare: false` on the pooled client, `closeDb()`
graceful shutdown, extension DDL hand-prepended in `0000`. Testing: the gate must not require
Docker on Chad's box — prefer **PGlite** as the `withTestDatabase` analogue for hub tests (real
Postgres dialect, in-process, no daemon), with testcontainers as fallback if PGlite lacks
something we need. `@vynel/cloud-db` is Postgres-only — no dialect seam needed (it never runs on
user machines).

## 3. Auth — how a desktop app signs in

Vynel auth is **fully separate from Anthropic auth**. The SDK keeps running on the user's own
Claude Code login (their subscription, their relationship with Anthropic). The Vynel account gates
Vynel features.

- **Sign-in method — DECIDED (Chad, 2026-07-10): email + password.** Hashing: **argon2id** (never
  bcrypt-with-defaults, never anything homemade), per-user salt, rate-limited per email + per IP,
  constant-time verification, generic "wrong email or password" errors (no account enumeration).
  Requires a **password-reset flow** (signed single-use email link, ~30-min expiry) → the hub
  needs an email provider from day one (Resend/Postmark — small, boring, fine).
- **Account creation is NOT self-serve on the desktop.** Accounts are provisioned by Chad's
  platform (§4). The desktop app only *signs in*; a "no account" error points the user at the
  platform. First credential: the platform provisions the account and the user receives a
  **set-your-password email link** (invite-style). The platform must never send us a plaintext
  password.
- **Tokens — the two-token split (Chad, 2026-07-10: "log in once, not again and again" AND
  "revoke → access gone").** Those two goals live in two different tokens on purpose:
  - **Rotating refresh token** (opaque, hashed at rest server-side, **~1-year sliding window**,
    rotation-with-reuse-detection so a stolen token burns the whole chain) = the *stay-signed-in*
    credential. This is what makes the user never re-enter a password — NOT a long-lived JWT.
    Bound to a **device record** (platform, app version, created/last-seen) → devices are
    listable and revocable per account.
  - **Short-lived signed entitlement/access JWT (§4, ~7 days)** = the *offline-verifiable proof*.
    Because it's short, revocation actually bites: a revoked account can't mint a new one, and
    the old one dies within days even if the machine never comes online.
  - Why not one 1-year JWT: a signed JWT verifies offline by design — the server can't reach out
    and un-sign it. A year-long JWT means a revoked user keeps a fully valid offline credential
    for up to a year. The refresh-token split gives the same "never log in again" UX with
    revocation that takes effect at the **next online contact** (app start, §4), bounded by days
    — not a year — when the machine stays offline.
- **Storage on the desktop:** refresh token in the OS credential store (Windows Credential Manager
  via the Tauri keyring plugin), never in a plain file, never in localStorage. Access token in
  memory only.
- **Key hygiene:** the hub signs with a private key that exists only in the server env; the app
  ships the **pinned public key** (rotation supported via a `kid` header + a two-key overlap
  window). No shared secrets in the app binary.

## 4. Access tiers + entitlements — what a tier unlocks and how it's enforced

- **`plans`** (hub-side): tier → set of **feature keys** + **limits**. Feature keys are stable
  strings the desktop gates on — e.g. `channels.telegram`, `voice.jarvis`, `marketplace.install`,
  `schedules`, plus limits like `workspaces.max`. The exact tier matrix is Chad's business call
  (fork §9-E); the mechanism doesn't care.
- **Grants — DECIDED (Chad, 2026-07-10): Chad's own platform provisions accounts AND handles
  payments, integrating via WEBHOOKS.** The hub never touches money. It exposes webhook endpoints
  the platform calls on four events: **`user.created` · `user.updated` · `user.removed` ·
  `tier.updated`**. Handler requirements:
  - **HMAC-signed** (shared secret server-side on both ends) with a timestamp + replay window;
    unsigned/stale requests rejected.
  - **Idempotent** — keyed on the platform's own user id (stored as `platformUserId` on the
    account) + a delivery/event id, so platform retries are safe. Out-of-order delivery handled
    by last-write-wins on an event timestamp.
  - `user.created` → account row + **set-your-password email link** (the platform never sends a
    password). `tier.updated` → grant changes; the desktop picks it up at the next boot check /
    silent refresh (§4 boot sequence — worst case the ~7-day token expiry). `user.removed` →
    account disabled, all device sessions revoked → next boot check logs the desktop out.
  A tiny hub-side **admin grant** path stays as the manual override/fallback.
  **Still open (§9-H):** exact payload schemas + signing scheme from the platform's side, and
  whether purchase should deep-link back into the desktop app.
- **The entitlement token:** after sign-in (and on every silent refresh) the hub issues a
  **signed entitlement JWT**: `userId`, `tier`, `features[]`, `limits`, `exp` (~7 days). The
  daemon verifies it **offline** against the pinned public key — the app is "almost offline"
  (Chad's words) and must work on a train.
- **Boot sequence — the account-status check (DECIDED, Chad 2026-07-10):** on every app start the
  daemon tries the hub with its refresh token.
  - **Online + account good** → fresh entitlement JWT, session silently extended. The same check
    re-runs on a slow interval (~daily) while the app stays open.
  - **Online + revoked/removed** → the refresh is refused → local session + cached tokens are
    cleared → the user is **logged out and the app locks to the sign-in screen**. This is the
    enforcement moment: revocation takes effect at the next online contact.
  - **Offline** → the cached entitlement JWT carries the app for as long as it's valid (the
    ~7-day expiry IS the offline grace window). Past expiry with no connectivity → the app locks
    until it can reach the hub once. Days of honest offline use, never a year of revoked use.
- **Revoked ≠ destroyed:** locking the app never touches the user's local data — workspaces,
  memory, and the SQLite DB stay on disk untouched; a re-granted account signs back in to
  everything. (Vision's trust promise: their data is theirs.)
- **Desktop gating seam:** one new module in the daemon (an `entitlements` read at boot + on
  refresh) that answers `hasFeature(key)` / `limitFor(key)`. Routes and sections check that seam —
  the UI's per-domain `enabled` gating from M7 is the natural hook. This is a *new* seam;
  `@vynel/capabilities` (per-workspace memory/knowledge toggles) is a user preference, not an
  entitlement, and stays as-is.

**Honesty on "no one can inject them":** the desktop runs on the user's machine — a determined
person can always patch a local binary; that is true of every desktop product. The professional
answer, and the one we take:

1. **Everything genuinely valuable is enforced server-side, which cannot be bypassed:** catalog
   access, artifact downloads, license redemption, app updates, and later cloud backup/sync all
   require a valid access token, checked on the hub per request.
2. Local gates use **asymmetric signatures + pinned public keys** — nothing to extract from the
   binary that lets someone mint entitlements; forging one means breaking Ed25519.
3. We do **not** burn effort on DRM beyond that. The durable moat is curation, updates, teaching,
   and support — all server-gated by construction.

## 5. Marketplace registry — holding and distributing the catalog

**Data model (hub):**

- `catalog_items` — `itemId`, `kind` (`skill | agent | mcp | rule | plugin`), display fields,
  category, `publisherId`, trust tier (`verified | community` — v1 ships **verified/Vynel Team
  only**; vision: curation is the value, no free-for-all), `recommendedScope`,
  `minimumTier` (which access tier may install), status (`draft | published | yanked`).
- `item_versions` — semver, changelog, `manifest` (JSON: entry file, declared tools, permissions),
  `artifactSha256`, `artifactSize`, `minAppVersion`, `releasedAt`.
- `publishers` — v1: one row. The table exists so community publishing later is a data change.

**Artifacts:** zip bundles (a skill = SKILL.md + resources; an agent = definition + prompts; an
MCP = descriptor + config template; a rule = markdown pack) in **object storage** (Cloudflare R2
recommended — S3-compatible, free egress). The hub serves metadata + short-lived download URLs;
it never streams big files through itself.

**Distribution security (supply chain — these things run on user machines):**

- The catalog response carries each version's **SHA-256**; the desktop verifies the downloaded
  artifact against it before installing. Add a detached **Ed25519 signature** per artifact (signed
  at publish time, verified with the pinned key) so even a compromised bucket can't ship a
  tampered bundle.
- Install materialization reuses the existing skills install path; the zip extractor rejects path
  traversal and symlinks; manifests are Zod-validated with size caps.
- **Downloads are tier-gated server-side** — `minimumTier` checked against the caller's
  entitlement on the download route. Browsing the catalog can be generous; installing is the gate.

**Desktop integration (the seam already reserved for this):**

- `resolveCatalogSources()` in `@vynel/contracts/marketplace` grows exactly as its header comment
  promises: merge the bundled `VERIFIED_SKILL_CATALOG` with a **locally cached cloud catalog**.
  A daemon sync job fetches `/catalog` (ETag/If-None-Match), caches rows in the product SQLite —
  marketplace browsing keeps working offline; every existing caller stays unchanged.
- `MarketplaceItem` gains `kind` (today `itemId === skillId`, one kind — the divergence the D7
  comment predicted) and installed-version tracking already exists (`versionInstalled`) → the
  catalog sync gives us **update available** badges nearly for free.

**Publishing pipeline v1:** a `registry publish` command in `apps/cli` (or `scripts/`) that
validates a bundle locally (manifest schema, size, no traversal), computes hash + signature,
uploads to R2, and inserts the version — auth'd by an admin token. A real admin UI is later.

**✅ M4a BUILT (2026-07-10) — the hub holds + distributes; the app-side consume is M4b.**
`packages/registry` leaf (publishers · catalog_items · item_versions, migration 0003) +
`apps/cloud-api` catalog routes + `ArtifactStore` seam (filesystem impl; R2 swap keeps the same
shape) + `pnpm cloud:publish` CLI (zips a bundle dir → base64 → admin publish). Advisor-revised
from this section: (a) the download gate reads tier **fresh from the DB, fail-closed** — never the
~7-day-stale token claim (browse fail-open, install fail-closed = the "browse generous, install
gated" line above); (b) the per-artifact **Ed25519 signature is DEFERRED to the object-storage
move** (hub serves catalog+bytes over TLS from one box → a detached sig protects nothing the
SHA-256-in-catalog doesn't yet, and then it needs a SEPARATE key from the token key); v1 integrity
= SHA-256 stored + recomputed on the desktop in M4b; (c) `minAppVersion` is stored but **not
enforced** (desktop still reports '0.0.0'); (d) the hub speaks its own `contracts/hub/catalog`
DTO, not skill-shaped `MarketplaceItem` — merging into the marketplace UI is M4b's job.

## 6. App updates (same hub, later milestone)

The Tauri updater consumes a static-shaped manifest (`latest.json` + signed installer). The hub
serves it (`/releases/desktop/latest`) — same storage, same signing discipline, and it makes
release rollout tier-stageable (e.g. beta channel) later. This is what makes the desktop app
*stay* real after the first install.

## 7. Track B — the real desktop app (Tauri v2, locked)

- **D1 — the app window (no cloud needed, highest visibility):** `apps/desktop` gains the main
  window loading local-web (dev: Vite URL, as the overlay does today; prod: built assets), spawns
  `local-api` as a **sidecar process** with health-check + restart + clean shutdown, keeps the
  Jarvis overlay window as-is. Result: Chad double-clicks one thing and Vynel opens like a product.
- **D2 — installer:** Tauri bundler → NSIS. The installer must also provision the **Node runtime**
  for the daemon — fork §9-F: bundle a pinned `node.exe` with the app (recommended: simplest,
  ~50 MB, no user action) vs compile the daemon to a single executable (SEA/pkg/Bun — nicer but a
  new build problem). Claude Code provisioning stays an onboarding step (its native installer —
  the wizard walks the user through sign-in to their own Claude subscription; that's the "user
  purchases Claude" motion, wizard-guided).
  **Real-world item:** a Windows code-signing certificate (SmartScreen trust) costs real money and
  lead time — decide early, ship D2 unsigned only for our own testing.
- **D3 — auto-update** via the Tauri updater against §6.
- **Sign-in step** joins the onboarding wizard when Track A's auth exists (wizard steps are
  already skippable — offline/dev keeps working).

## 8. Sequencing proposal

Each milestone is one module moved small-by-small, gate-green, reviewed, committed — per
`build-discipline.md`.

| # | Milestone | Deliverable Chad can see |
|---|-----------|--------------------------|
| 1 | **D1 desktop shell** | Vynel opens as a real app window (one double-click in dev) |
| 2 | **Hub skeleton + accounts** (`cloud-db` on Neon, `accounts`, email+password auth, reset emails, devices) | sign in from the app; devices listed/revocable |
| 3 | **Tiers + entitlements** (plans, the platform provisioning API, signed token, daemon gate seam) | a platform-provisioned user signs in → their tier's features unlock; lapsed → degrade |
| 4 | **Registry** (items/versions, R2 artifacts, signed downloads, catalog sync + merge) | browse the REAL cloud catalog in the app; install a skill served from the cloud |
| 5 | **D2 installer** (+ Node runtime bundling) | installable .exe for a workshop student |
| 6 | **Releases + D3 updater**; payments when there's something to buy | app updates itself |

**DECIDED (Chad, 2026-07-10): D1 first** — he asked to *see a real desktop app*, and it's the
cheapest, most motivating win; the hub follows immediately.

## 9. Decision forks (✅ = decided by Chad 2026-07-10)

- **A. Hosting — ✅ Chad's own servers.** Build first, deploy there when complete. Ship the hub as
  a **Docker image** (host-agnostic; runs anywhere his boxes do). Postgres: Neon or a Postgres
  container on the same servers — deploy-time choice, the code doesn't care (the pooled/direct +
  `prepare:false` notes in §2 only bite if a transaction-mode pooler sits in front). R2 for
  artifacts either way.
- **B. Hub DB — ✅ Postgres (Neon) from day one** (§2: pooled/direct split, PGlite test substrate).
- **C. Sign-in — ✅ email + password** (§3: argon2id, reset emails, platform-provisioned accounts).
- **D. Monetization — ✅ Chad's own platform provisions users and handles payments** (§4: the hub
  exposes a provisioning API; no payment code in the hub).
- **E. Tier matrix — ✅ (Chad, 2026-07-10): two tiers — `basic` = channels ONLY · `pro` =
  everything.** Encoded in `@vynel/contracts/hub/entitlements` `TIER_FEATURES`. Gateable feature
  keys: channels · voice · schedules · knowledge · memory · marketplace (core chat + workspaces
  never gated). Voice is its own key, pro-only for now (a one-entry flip moves it into basic).
- **F. Daemon runtime packaging — OPEN:** bundle pinned Node (**recommended**) vs
  single-executable compile — needed before milestone 5.
- **G. Sequence — ✅ D1 desktop shell first**, then the hub milestones in §8 order.
- **H. Platform integration — ✅ WEBHOOKS** (`user.created/updated/removed` + `tier.updated`, §4).
  **✅ (Chad, 2026-07-10): the platform sends whatever payload WE need — the webhook contract is
  OURS to author** (Zod schemas in `@vynel/contracts`, shared with the hub's routes). Remaining
  open: the signing-secret exchange at deploy time, and whether purchase should deep-link back
  into the desktop app.
- **I. Session lifetime — ✅ log in once, revocation on next online contact** (§3 two-token split:
  ~1-year rotating refresh token = stay signed in; ~7-day signed entitlement JWT = offline grace;
  boot-time account-status check enforces revocation → logged out + app locked, §4).

## 10. Lines held (from vision §8)

Never resell models — the user's Claude subscription is theirs, the wizard just walks them into
it. No free-for-all marketplace — v1 publishes Vynel Team only. Every irreversible install still
passes the approval-card discipline. Offline keeps working within the entitlement grace window
(~7 days), and a lock never touches the user's local data (§4) — their workspaces and memory are
theirs even when their access isn't.
