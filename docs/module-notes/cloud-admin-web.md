# cloud-admin-web — the marketplace admin portal (module notes)

**Chad's ask (2026-07-12):** an admin portal to manage marketplace items — agents, skills, rules,
plugins, MCPs — so users can browse and install them when they need them. Chad named the app:
**`apps/cloud-admin-web`**.

**Status: PLANNED — not started.** This doc is the Gate-1 shape. Read `docs/module-notes/cloud-api.md`
first (the hub discovery doc) — the portal is the "real admin tooling" that the current
`CLOUD_ADMIN_TOKEN`-guarded `/admin` fallback routes and the `cloud:publish` CLI explicitly stand in
for.

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
