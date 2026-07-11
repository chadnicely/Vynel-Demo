# cloud-admin-web — the marketplace admin portal (module notes)

**Chad's ask (2026-07-12):** an admin portal to manage marketplace items — agents, skills, rules,
plugins, MCPs — so users can browse and install them when they need them. Chad named the app:
**`apps/cloud-admin-web`**.

**Status: Phase A + Phase B BUILT (2026-07-12, both reviewer-clean) — Phase C (non-skill kinds on
desktop) and hub-served static hosting remain.**

## ✅ Phase B as built (2026-07-12)

`apps/cloud-admin-web` — Vue 3 + Vite + @tanstack/vue-query SPA (subagent-built to spec, mirrors
local-web idioms: per-feature composables + keys files, happy-dom project tests, dark token CSS).
Run: `pnpm --filter @vynel/cloud-admin-web dev` → `http://localhost:8891` (Vite proxies `/api` →
`localhost:8890`, prefix-stripped — the gateway dev==prod-paths precedent).

- **Session**: access token in sessionStorage ONLY (deliberate: admin tool, per-browser-session
  credentials; refresh-token persistence is non-scope until hub-served). 401 → session cleared →
  sign-in; 403 → the full-page "not an admin" card (auth is generic — the gate is per-request).
- **Views**: SignIn · Catalog (kind filter tabs, status chips, list from GET /admin/catalog) ·
  CatalogItem (dirty-tracked sparse PATCH · two-step yank confirm · versions table w/ sha copy ·
  publish-new-version zip→base64 with vynel-team publisher prefill) · Accounts (provision +
  role-grant forms; list-accounts endpoint doesn't exist yet — said honestly in the UI).
- **Review round applied**: FileReader failure surfaced + abort handled · file input cleared after
  publish · **hub-side `jsonValidator` wrapper** (zod issues → `ValidationError` → the one
  `{code,message}` envelope; swept every cloud-api route) · contracts admin DTO tightened to enums
  (normalize lives in the registry mapper) · queryClient.clear() on sign-out · clipboard reject
  caught · PATCH description cap aligned to publish's 280.
- **LIVE-SMOKED** (2026-07-12): portal → proxy → running hub → 401 → anti-enumeration message
  rendered. Authenticated flows are Chad's smoke (sign in as kaone.kafi@gmail.com after
  set-password; browse catalog; yank/un-yank email-drafter; publish a version bump).
- **Deferred**: hub-served dist (`/admin-app` static from the Docker image — needs the static-serve
  helper extracted from local-api into a shared package; deploy arc) · token refresh mid-session ·
  fold the portal's trimmed `tokens.css` into `@vynel/ui` when hub-served lands. Read
`docs/module-notes/cloud-api.md` first (the hub discovery doc) — the portal is the "real admin
tooling" that the current `CLOUD_ADMIN_TOKEN`-guarded `/admin` fallback routes and the
`cloud:publish` CLI explicitly stand in for.

## ✅ Phase A as built (2026-07-12)

Chad's fork answers: **real admin accounts** (role column) · **deprecate-only** (= the existing
`yanked` status vocabulary; hard purge stays a future confirm-twice CLI action, never a portal
button, never frees the version number).

- **`accounts.role`** `'member' | 'admin'` (default member) — cloud migration `0004_account_role`
  (purely additive; the boot migrator applies it to the live docker volume on next hub start) +
  `setAccountRole` repo fn.
- **`@vynel/accounts` `roles/`**: `resolveActiveAccountRole` (FRESH per-request authority — the
  tier-staleness rule applied to admin power) + `assignAccountRole` (404 on unknown account).
- **Dual-door `requireAdminAccess`** (cloud-api middleware): static `CLOUD_ADMIN_TOKEN`
  (sha256 + timingSafeEqual) OR a verified access JWT whose account is an active admin, role read
  fresh. Same 401 for wrong-token and bad-JWT (no door oracle); 403 only for a valid non-admin.
  `requireAdminToken` deleted (dead after the switch). Reviewer confirmed: no self-grant path —
  the role route sits behind the same middleware; bootstrap = the static token.
- **Registry lifecycle**: `listCatalogForAdmin` (ALL statuses + full version history) ·
  `updateCatalogItemMetadata` (zod patch, empty patch → 400) · `setCatalogItemLifecycleStatus`
  (draft | published | yanked — yank kills browse AND download instantly, un-yank restores;
  proven in tests).
- **Routes**: `/admin` grew `GET /catalog` · `PATCH /catalog/:itemId` · `POST /catalog/:itemId/status`
  · `POST /accounts/:accountId/role`. Wire DTO: `@vynel/contracts/hub/admin` (`HubAdminCatalogItem`).
- **Deferred-improves (reviewer nits, next touch):** shared `toHubPublisherTier` mapper (small
  duplication) · `listCatalogForAdmin` is N+1 on versions (fine at admin scale).

**Bootstrap (Chad, one-time):** restart the hub (applies 0004), then grant your account admin via
the static door: `curl -X POST $HUB/admin/accounts/<your-account-id>/role -H "Authorization: Bearer
$CLOUD_ADMIN_TOKEN" -H "content-type: application/json" -d '{"role":"admin"}'`.

## What already exists (don't rebuild)

- **`@vynel/registry` is kind-agnostic from day one** — `catalog_items.kind` already takes
  `skill | agent | mcp | rule | plugin`; publish, tier-gating (`authorizeCatalogDownload`), artifact
  storage (`ArtifactStore` seam + sha256 integrity) and the byte-immutability conflict check all
  live in the leaf after the 2026-07-12 discipline round. The portal is a FACE plus lifecycle, not
  a new engine.
- **`publishCatalogArtifact(db, store, input)`** is the one publish home — the portal's upload
  endpoint calls the same function the CLI-backed `/admin/catalog/publish` does.
- **Auth machinery**: email+password sign-in, EdDSA access tokens, `requireAccount` middleware,
  set-password links — all shipped (M2a/M3). The portal reuses it; nothing new to invent for
  credentials.
- **Precedent for a hub-served page**: `set-password-page.ts` (inline HTML). The portal replaces
  that pattern with a real built app.

## The shape (three phases, each its own commit arc)

### Phase A — backend: admin identity + catalog lifecycle

1. **Admin role on accounts** (incremental cloud migration): `accounts.role` `'member' | 'admin'`,
   default `'member'`. New middleware `requireAdminAccount` = `requireAccount` + a FRESH role read
   (same staleness rule as tiers: never trust the ~7-day token for authority). The static
   `CLOUD_ADMIN_TOKEN` stays for the CLI/server-to-server path — two doors, one core.
2. **Lifecycle core in `@vynel/registry`** (each with leaf tests over PGlite):
   `listCatalogForAdmin` (ALL statuses + version history), `updateCatalogItemMetadata`
   (display/description/category/icon/minimumTier/recommendedScope), `setCatalogItemStatus`
   (published ⇄ draft ⇄ deprecated — already exists as a repo fn; promote deliberately),
   and reuse `publishCatalogArtifact` for new versions.
3. **Thin `/admin` route growth**: GET list, PATCH item, POST status, POST publish (existing).
   Keep base64 upload v1 (10MB cap holds; multipart is an optimization, not a blocker).

### Phase B — `apps/cloud-admin-web`: the portal app

- **Vue 3 + Vite + vue-query**, same house patterns as `apps/local-web` (composables per feature,
  small components). It is a THIN surface: parse → call cloud-api → render. No business logic.
- **Served by cloud-api** at `/admin-app` from its built dist (the local-web/gateway static-serve
  precedent — traversal-guarded absolute-root static + SPA fallback). One Docker image stays the
  whole hub deployable.
- **Screens (v1):** sign-in (admin accounts only — a `member` gets a plain "not an admin" card) ·
  items table grouped by KIND (skill/agent/mcp/rule/plugin) with status chips · item detail
  (metadata form + version history + minimum-tier select) · "publish new version" (zip picker →
  base64 → the existing endpoint) · accounts list (provision + tier set — the manual webhook
  stand-in Chad uses today via curl).

### Phase C — desktop consumes non-skill kinds (separate arc, already on the roadmap)

The STATE.md "next arcs" list already names it: `kind` on `MarketplaceItem`, per-kind install paths
(agent/rule/mcp/plugin), update-flow ("catalog version > installed"). The portal makes the content
exist; this arc makes it land in the app. Do not start it inside the portal arc.

## Forks for Chad (answer before Phase A)

1. **Admin accounts vs token-only portal.** Recommended: real `role` column (small additive
   migration, proper audit trail, revocable). Token-only (paste CLOUD_ADMIN_TOKEN into the UI)
   ships faster but leaks a root secret into browsers — not worth it.
2. **Who publishes?** v1 stays curated (Vynel-Team publisher only). Third-party publisher
   onboarding is a different product (review queues, signing) — explicitly out of scope.
3. **Deprecate vs delete.** Versions are byte-immutable; recommend deprecate-only (installed copies
   keep verifying). Hard-delete only for a never-installed mistake, admin-confirmed.
