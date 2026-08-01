# Module notes — admin repo publish (Task 1, 2026-08-02)

Admin portal publishes marketplace resources from a GitHub repo URL (besides zip upload),
captures credits (publisher picker + sourceUrl), and the catalog forms get an icon picker
(curated lucide allowlist) and a category select (admin-defined, open strings).

## Settled decisions (Chad — do not relitigate)

- Repo import covers **all five kinds**; repo folders follow the seed-bundle layout
  (`scripts/seed-catalog/<itemId>/` — entry file at the folder root: SKILL.md / agent.json /
  server-descriptor.json / rule-descriptor.json / delegate-descriptor.json; `vynel-item.json`
  is bundle metadata, excluded from the artifact).
- **Categories are admin-defined and global**: hub stores free strings; the desktop renders
  them **verbatim** (the `toSkillCategory → 'context'` coercion is dead); the closed
  `SkillCategory` union survives only for the bundled verified catalog.
- **Icon picker = curated allowlist**, ONE home `@vynel/contracts/marketplace/catalog-icons`
  (48 names, all verified in lucide-vue-next@0.468), consumed by the portal picker AND the
  desktop card map (both typed `Record<CatalogIconName, Component>` — drift fails compile).
- Security: https-only + github.com host allowlist (no embedded credentials, no query/hash),
  ref→sha **resolve-then-pin** (`ls-remote`, 40-hex passthrough), hardened git runner
  (`protocol.ext.allow=never`, `--` separators, timeout, tmpdir cleanup in finally, sha
  asserts), subpath segment validation + resolved-path containment, and server-side archive
  inspection at publish.

## The shape built

- `packages/registry/src/git-fetch.ts` — the ONE git home (`runGit`, `cloneRepoAtPin`,
  `resolveRepoRefToSha`); import-anthropic and upstream-watch rewired onto it.
- `packages/registry/src/pack-item-folder.ts` — kind-aware packing (`ENTRY_FILE_BY_KIND`),
  excludes `vynel-item.json` + any `.git`; replaced `zipSkillFolder` (CLI rewired).
- `packages/registry/src/inspect-artifact-archive.ts` — publish-time zip wall (invalid zip,
  entry flood, traversal/absolute/backslash, symlink, case-fold collision, declared-size
  bombs; never inflates). Called inside `publishCatalogArtifact`, so BOTH the direct upload
  and the repo path pass it. Rules shared via
  `@vynel/contracts/hub/artifact-archive-rules` (constants + pure predicates; no zip dep in
  contracts); `packages/skills` extractor consumes the same rules.
- `packages/registry/src/repo-source.ts` — URL wall, subpath normalization, resolve+clone
  tempdir lifecycle with an injectable git-deps seam (`RepoGitDeps`) so tests run REAL git
  against local fixture repos while the URL wall stays absolute.
- `packages/registry/src/publish-from-repo.ts` + `inspect-repo-source.ts` — the operation +
  its preview (lenient `vynel-item.json` prefill / entry-file kind detection). sourceUrl
  defaults to `<repo>/tree/<sha>/<subpath>`.
- Routes: `POST /admin/catalog/publish-from-repo`, `POST /admin/catalog/inspect-repo`
  (fluent chain, jsonValidator, typed errors → existing envelope).
- Portal: PublishItemView mode toggle (zip / GitHub URL) with logic extracted to
  `use-publish-item-form.ts`; new `IconPicker` / `CategorySelect` / `PublisherPicker` /
  `RepoSourceFields` components used by PublishItemView + ItemMetadataForm; composables
  `use-publish-from-repo` / `use-inspect-repo` / `use-catalog-categories` /
  `use-catalog-publishers`.
- Credits: publisher dropdown over catalog-derived publishers ("exact stored fields" rule —
  only "+ new publisher" sends fresh values; `HubAdminCatalogItem` gained `publisherUrl` so
  bumps can re-send it). **Fixed live bug**: PublishVersionForm hardcoded vynel-team and
  dropped `sourceUrl` on every version bump (upsert then silently rewrote publisher + nulled
  the credit link) — it now passes the item's current publisher + sourceUrl verbatim.
- Tests now publish REAL zips (`@vynel/registry/testing` → `zipArtifact`) since publish
  inspects bytes.

## Deferred / consciously left

- `readDeclaredUncompressedSize` is now a THIRD copy (skills, agents, registry) — the shared
  home needs a zip-capable package; contracts stays zod-only by design. Extract when one
  exists.
- `packages/agents` extractor keeps its own tighter caps (1MB artifact / 256KB manifest,
  single-entry read) — different rules on purpose, not folded into the shared archive rules.
- Hub inspection never inflates (declared sizes only); the desktop's post-inflate backstops
  remain the write-time authority.
- Private-repo auth (tokens), non-github hosts, OAuth: out of scope by decision.
- No desktop category filter chips exist yet (search covers categories); chips derive from
  data whenever they land.
- Portal icon component maps exist twice (portal + desktop bundles) — names have one home in
  contracts; both maps are compile-checked against it.
