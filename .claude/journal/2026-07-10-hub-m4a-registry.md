# 2026-07-10 — Hub M4a: the marketplace registry (hold + distribute)

**The move.** The hub becomes "the real marketplace data holder" from Chad's opening ask:
`packages/registry` leaf (publishers · catalog_items · item_versions), catalog routes with a
tier-gated download, a filesystem `ArtifactStore` behind a seam, and a `pnpm cloud:publish` CLI.
Advisor-vetted before building; full gate 2107/4-skip; live-smoked (CLI published the seed skill to
Chad's running hub → row + artifact + sha256 confirmed in Postgres). M4b (desktop sync + install)
is the consuming half.

## Learnings worth keeping

- **The tier gate on paid content must read tier FRESH from the DB, fail-closed.** The entitlement
  token is ~7 days valid; trusting its `tier` claim on a download route would let a downgraded user
  pull pro artifacts for a week — the M3 staleness class at its highest-stakes spot. The route
  looks `tier` up from `accounts` on every download via `resolveEffectiveTier`, and denies when
  there's no active account. Browse is fail-OPEN (gone account → basic, still shown); install is
  fail-CLOSED. That asymmetry IS the product's "browse generous, install gated" line — a test pins
  the downgrade-defeats-a-valid-token case.
- **Don't add a signature that protects nothing yet.** A detached Ed25519 artifact signature guards
  against tampering by storage *separate from the signing authority*. In v1 the hub serves the
  catalog (carrying the sha256) AND the bytes over TLS from one box where the key would also live —
  so it adds nothing over sha256-in-the-catalog. Deferred to the object-storage move, and then with
  a SEPARATE key (the M3 token-separation lesson, one trust-domain further: artifact-key compromise
  is supply-chain RCE, must rotate independently of sessions). v1 integrity floor = sha256 stored,
  recomputed on the desktop in M4b — don't skip that.
- **The hub gets its own DTO; don't inherit the skill shape.** `MarketplaceItem` is skill-shaped
  (skillId, SkillCategory, SkillScope). The registry is kind-agnostic (skill|agent|mcp|rule|plugin).
  A fresh `contracts/hub/catalog` DTO keeps the hub honest; merging cloud items into the marketplace
  UI is M4b's hard problem, deliberately not smeared into M4a.
- **Manifest stays opaque.** The per-kind install manifest is validated as a bounded JSON object
  and stored as a string — never parsed per-kind on the hub. A new item kind needs zero hub change;
  the desktop installer owns the manifest's meaning.
- **`Buffer` isn't Hono's `c.body` type** (it wants `ArrayBuffer`); return a web `Response` with a
  fresh `Uint8Array` view of the bytes instead.
- **First milestone with no in-app payoff, on purpose.** Set with Chad up front: M4a's proof is the
  publish CLI + the tier-gated-download tests/curl, not a screen. The app payoff is M4b.

## Deferred (M4b + beyond)

Desktop catalog sync (fetch /catalog, ETag-cache in product SQLite, merge through
`resolveCatalogSources()`) · download + sha256-recompute + extract + materialize per kind ·
`MarketplaceItem` gains `kind` + the cloud/bundled merge + "update available" badges · object
storage (R2) + presigned URLs + the detached signature with its own key · a real admin publish UI ·
N+1 latest-version lookup is fine for a curated catalog (revisit at scale).
