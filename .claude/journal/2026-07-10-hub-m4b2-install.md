# 2026-07-10 — Hub M4b-2: marketplace install (the arc's payoff)

**The move.** The "Get" button finally installs — for cloud AND bundled items. Cloud path:
download the artifact through the hub session → recompute + verify sha256 against the catalog's
recorded hash → extract SKILL.md → materialize on disk + record `installedFromSource:'marketplace'`.
Bundled path: the existing template install. One route (`POST /marketplace/install`) dispatches by
cache membership. This closes the whole D1→M4 arc: a skill published to the hub is now installable
from the desktop.

## Learnings worth keeping

- **Verify integrity BEFORE parsing a single byte.** `installCloudSkill` recomputes sha256 and
  compares to the catalog's recorded hash as step 1 — extraction only ever runs on bytes the hub
  vouched for. This is what makes the zip-bomb / malformed-archive surface small: the sha (served
  in the catalog over TLS, M4a) is the trust anchor, so a tampered or corrupt artifact is rejected
  before jszip touches it.
- **v1 skill install reads ONE named file, never extracts arbitrary paths.** Classic zip-slip
  (path traversal on extraction) isn't a vector because we read only `SKILL.md` from the archive
  and write it to a resolved skills-root path we control — not archive-relative paths. The entry
  cap + content-size cap are defense-in-depth. A future multi-file bundle MUST add full per-entry
  traversal/absolute/symlink guards before writing extracted paths to disk — flagged in the code.
- **Disk-first, then the DB tx** — reused the existing install-skill ordering (D8): a disk-write
  failure leaves no DB row (no orphan row); a DB failure leaves an on-disk orphan the sync job
  reconciles. The cloud install is a faithful twin of the template install, differing only in
  content source (verified artifact vs in-code template) and `installedFromSource`.
- **One route, dispatched by cache membership.** The Get button doesn't need to know cloud-vs-
  bundled: `POST /marketplace/install` looks the item up in the cloud cache — present → download +
  cloud-install, absent → bundled template install. The UI stays simple; the seam is server-side.
- **`installedFromSource:'marketplace'` was reserved since Phase 1** (the skills schema had the
  union value with a "Phase 1.5" comment, unused). M4b-2 is the first writer — the schema
  anticipated this exactly.
- **The tier matrix makes marketplace Pro-only**, so in practice only Pro users reach install via
  the app (basic sees the whole section locked). The hub download route's per-item tier gate is
  the belt to the section-gate's suspenders.

## Deferred / future

Multi-file skill bundles (per-entry safe extraction to disk) · settings-bearing cloud skills
(manifest transport: in-zip, sha-covered) · non-skill kinds (agent/mcp/rule install paths +
`kind` on MarketplaceItem) · streaming zip-bomb guard (uncompressed-size cap during read) · update
flow (catalog version > installed → "update available" + reinstall) · the object-storage move
(R2 presigned download + the detached artifact signature with its own key).
