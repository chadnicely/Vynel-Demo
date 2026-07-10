# 2026-07-10 — Hub M4b-1: desktop catalog sync + merged browse

**The move.** The desktop now consumes the hub's cloud catalog: a daemon sync job caches
`/catalog` in product SQLite, and the marketplace merges it with the bundled catalog so a
cloud-published item (email-drafter) appears in the app's Marketplace section. The read half of
M4b; install is M4b-2. Advisor-vetted; full gate 2116/4-skip.

## Learnings worth keeping

- **The collision was the whole game.** email-drafter ships in the bundled catalog AND I seeded it
  to the cloud in M4a — a naive merge makes two rows with the same itemId, and the install-status
  annotation (keyed on skillId) double-counts. Dedup by itemId, CLOUD-WINS, with a test built on
  exactly that collision. The advisor caught this before the first merge; it would have been a
  confusing bug otherwise.
- **Cache the item, never the annotation.** `canInstall` is caller/tier-specific and staleness-
  prone — the exact class M4a's fresh-tier gate fought. The cache stores the tier-NEUTRAL row
  (item + minimumTier + sha); the "Pro" badge is computed client-side for display, and the real
  install gate stays server-side fail-closed. Caching `canInstall` would have re-introduced the
  bug one layer down.
- **Keep the reserved seam pure; merge where the db is.** `resolveCatalogSources()` (contracts)
  can't do the cloud merge — merging needs the product db, which contracts can't touch. So it
  stays the bundled→MarketplaceItem mapper, and the real merge lives in the marketplace leaf
  (`resolveMergedCatalog(db)`), which the two read callers now use. better-sqlite3 is SYNC, so the
  cache read keeps `listMarketplaceItems` synchronous — no signature churn, no async ripple.
- **Offline-KEEPS vs signed-out-CLEARS is decided by the session's verdict, not the exception.**
  `fetchCatalog` self-restores; on failure the sync service reads `getStatus().kind` — 'offline'
  keeps the cache (browse offline), everything else clears it (a signed-out user sees bundled
  only). Distinguishing offline from signed-out purely by the thrown error is impossible (both
  surface as UnauthorizedError from withAccessToken) — the status is the source of truth.
- **A tier matrix consequence surfaced in the UI:** basic = channels-only means a signed-in basic
  user has the WHOLE marketplace section locked (not per-item) — so the per-item "Pro" badge only
  shows in the signed-out/not-configured browse. Correct per Chad's matrix; worth remembering when
  M4b-2 wires install (a basic user never reaches the Get button via the app).
- **D1 "marketplace owns no tables" was a bundled-catalog artifact** — the cloud cache retires the
  premise. Named the supersede in the leaf's index.ts so it reads as a decision, not a slip.

## Deferred → M4b-2 (install)

Wire the dead "Get" button (install works for NEITHER bundled nor cloud today) · hub download +
recompute-sha256-and-compare + zip extract (traversal/absolute/symlink-safe, zip-bomb caps) ·
cloud-install path stamping `installedFromSource:'marketplace'` + `versionInstalled` · manifest
transport decision (in-zip vs DTO) only when a non-skill or settings-bearing item ships · `kind`
on MarketplaceItem when a non-skill kind ships.
