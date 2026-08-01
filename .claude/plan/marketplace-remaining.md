# Marketplace — remaining work plan

**Written 2026-08-01, at the close of the claude-official arc** (research → Phase A five moves →
Phase B slice 1, all shipped + smoked; commits `c3acafd`…`eb6bccb`). Full context:
`docs/module-notes/marketplace-claude-official.md` (decisions, findings, deferred rationale) +
`.claude/STATE.md`. This file is the ordered TODO; check items off as arcs land.

## Arc 1 — skills become INSTALL/UNINSTALL ONLY ✅ COMPLETE (gate green 2026-08-02)

Chad's call (2026-08-01): a skill is one file-tree on disk — the only honest states are present
and absent. Remove the enable/disable pause state (reverses skills D11).

- [x] Drop `installed_skills.isEnabled` — migration `0026_drop_installed_skills_is_enabled`
      via drizzle-kit generate (single clean `DROP COLUMN`)
- [x] Delete `enable-skill.ts` + `disable-skill.ts` (+ tests) and the two routes
      (`POST /installed/:id/enable|disable`); local-web On/Off pill removed
      (WorkspaceSectionPanel); `SKILL_ENABLED_CHANGED` event + payload gone; CLI
      `skills enable|disable` commands gone
- [x] Remove `update-cloud-skill.ts`'s disabled guard + its test (moot without the state)
- [x] Sweep `isEnabled` from types/serializers/schemas/views; SDK+MCP regen (skills SDK
      roster 8 → 6 methods; MCP tools unchanged — enable/disable never carried x-mcp)
- [x] Re-check `update-skill-settings.ts` (re-renders unconditionally now),
      `synchronize-skills-with-provider.ts` (insert minus the flag),
      `list-installed-skills-for-context.ts` (never read it)
- [x] **UX:** armed Remove now shows "Removes it from this device and deletes its settings."
      + extended aria-label on the marketplace card
- [x] Free wins: pure-cloud enable-void CLOSED; template-clobber's enable half closed
      (settings half remains — recorded in module-notes deferred)
- Scope note: skills only — agents keep their enabled state (`options.agents` resolution)
- Verified: scoped checks green, then the **full `pnpm test` gate GREEN 2026-08-02**
  (3439 passed / 613 files); reviewer clean

## Arc 2 — marketplace polish batch ✅ COMPLETE (gate green 2026-08-02)

- [x] **Update-button truth signal:** `MarketplaceItem.hasCloudArtifact` (merge-time fact —
      true only for cloud-cached SKILL rows, exactly what the update route serves); the card's
      `hasUpdate` gates on it; regression test for the bundled-drifted case
- [x] **Admin portal:** Publisher column beside Kind; `sourceUrl` editable end-to-end (zod
      mirrors publish-input, repo patch field, form input with ''↔null mapping)
- [x] **Plugin-reader seam:** `marketplaceInstalledPluginsReader` on CreateAppOptions/context
      (mirror of `marketplacePluginDelegate`); `marketplaceDepsWith(reader)` replaces the
      static `marketplaceDeps`; all 4 marketplace route test files inject stubs — the
      `vi.mock('@vynel/providers')` hack is gone
- [x] **Housekeeping:** shared `internal/verify-artifact-sha256.ts` (install/update);
      all four marketplace MCP descriptions mention plugins; template-clobber settings-half
      guard (`installedFromSource !== 'marketplace'` on template re-render) + regression test
- Verified: scoped checks green, reviewer clean (allowlist tightening applied), then the
  **full `pnpm test` gate GREEN 2026-08-02** (3441 passed / 613 files)

## Arc 3 — the last catalog kinds (CALLS SETTLED 2026-08-02, AskUserQuestion)

Chad's calls: ① mcp kind = **config-is-truth** (plugin pattern — the Claude config file is the
source of truth, no Vynel table) ② **sessions (global or workspace) can install MCP servers
via the tool, auto-tier, NO card** (standard mutatingApproved like skill installs — not
askApproval) ③ rule kind = **plain `.claude/rules/*.md` files** (native location Claude Code
reads; no notebook-leaf dependency) ④ work order = follow this plan's pipeline.

- [x] **`mcp` kind** ✅ COMPLETE (gate green 2026-08-02, 3452/614) — config-is-truth end-to-end: `McpItemManifest`
      contract (shape = skills' `SkillRequiredMcpServer`, parse-at-merge, unparsable filtered);
      skills `mcp-servers/` ops (install/remove/list over `~/.claude.json` + workspace
      `.mcp.json` — the leaf's single-writer rule); annotator matches by serverName (workspace
      preferred D12, version-less); per-kind dispatch split into `mcp-item-lifecycle.ts` +
      `plugin-item-lifecycle.ts` (file-size ceiling); rides the existing workspace install tool
      (mutatingApproved, no card — Chad's call; the global root reaches it via delegation);
      seed item `playwright-mcp` (@playwright/mcp via npx); reviewer CLEAN.
      `claude_desktop_config.json` bridge deferred until Chad uses Claude Desktop.
      Curation rule (reviewer): two catalog items must never declare the same `serverName`
- [x] **`rule` kind** ✅ COMPLETE (gate green 3466/616 + smoked 2026-08-02) — config-is-truth twin
      of mcp: `RuleItemManifest` (manifest carries the markdown); skills `rules/` ops write a
      PROVENANCE-MARKED `<id>.md` into `~/.claude/rules/` / `<workspace>/.claude/rules/`
      (native Claude locations). The marker is the hand-authored-file guarantee: unmarked (or
      other-marked) files never annotate, never get overwritten (409), never get deleted —
      the agents slug-collision precedent as files. Marker parse tolerates CRLF + BOM
      re-saves (pinned in rule-file-marker.test.ts). `rule-item-lifecycle.ts` +
      `rulesReaderFor`; seed `conventional-commits`; reviewer CLEAN (marker-mismatch
      install gate + parser tests applied)
- [x] **Plugin updates** ✅ CODE-COMPLETE 2026-08-02 (full gate pending) — `updateClaudePlugin`
      (`claude plugin update <name>@<marketplace>`; no `--scope`, the installed entry fixes it),
      delegate `update`, `updatePluginItem` with REGISTRY RE-READ version (response = what
      Claude Code actually holds; test pins 1.1.1-registry vs 1.1.0-catalog), update response
      = discriminated union, card Update for drifted plugins, refusal 400 test (rule item);
      reviewer CLEAN (all 4 should-fixes applied). ⚠ Smoke note: `claude plugin update`
      flag shape unverified against the live CLI — a wrong shape surfaces as an actionable
      400, so the first real Update click proves it
- [ ] **More official plugins** — machinery ships anything now; each addition = curation +
      trust review; plugins stay structurally user-scope (off the workspace tool)

## Arc 4 — operations & production hardening (assessed 2026-08-02; mostly gated on Chad)

- [x] **Upstream-watch automation** ✅ CODE-COMPLETE 2026-08-02 (Chad's call: a cron ON the
      hub, not a desktop schedule) — logic extracted to `@vynel/registry` `upstream-watch.ts`
      (blob-less clone, per-folder pin..HEAD verdicts, re-pin recipe; local-git-fixture
      tests; arg-injection hardened); cloud-api runs it as an in-process daily job
      (`upstream-watch-job.ts`, first run 15s post-boot, manifest re-read per run,
      env `CLOUD_UPSTREAM_MANIFEST_PATH`/`_INTERVAL_HOURS`); `GET/POST /admin/upstream-watch`
      behind the dual door; portal CatalogView shows an amber drift banner when republished
      folders moved. The CLI (`pnpm cloud:check-anthropic`) is now a thin printer over the
      same module (live-smoked: up to date @b29e7cf)
- [ ] **Hub production track** — per-item reality:
      · R2 object storage — OUT OF V1 (Chad 2026-08-02, twice-confirmed): the server-disk
        filesystem ArtifactStore ships as v1's store; R2 is a FUTURE implement (needs his
        Cloudflare bucket + token; the swap stays small — the interface was built for it)
      · `minAppVersion` enforcement — BLOCKED on D2 installer stamping real versions
      · real mail sender — BLOCKED on Chad's provider choice + API key (dev logs links today)

## Arc 4 slice 2 — PORTAL-BUTTON PUBLISHING ✅ SHIPPED (`2d9263b`, 2026-08-02)

Landed exactly per the settled design below (kept as the as-built record). Verified: registry
git-fixture + PGlite tests (faithful zip w/ license + nested assets, sha↔DB match, idempotent
re-run, hand-published bytes untouched, invalid-manifest refusal) + route configured:false/401;
reviewer CLEAN (2 should-fixes applied: NotFoundError ctor shape; `protocol.ext.allow=never`
git hardening — swept into upstream-watch.ts too); **full gate GREEN (3476 passed / 618 files)**.

1. **Registry module `packages/registry/src/import-anthropic.ts`** —
   `importAnthropicItems(db, artifactStore, manifest): Promise<{items: Array<{itemId, version,
   outcome: 'published'|'skipped-already-published', bytes}>}>`. Server-side clone of
   `manifest.upstream.repo` AT the pin into a mkdtemp dir (try shallow sha fetch:
   `git init` + `remote add origin -- <repo>` + `fetch --depth 1 origin <sha>` + `checkout
   FETCH_HEAD`; GitHub allows sha-fetch; fall back to full clone + checkout on failure).
   HARDENING like upstream-watch.ts: validate pinnedSha `/^[0-9a-f]{40}$/`, `--` before repo
   arg, 10-min execFile timeout, tmpdir rm in finally. Zip each `skills/<itemId>` folder
   (move the CLI's `listFiles` + `zipSkillFolder` INTO this module and export them — root
   SKILL.md required, DEFLATE). Publish INTERNALLY via `publishCatalogArtifact` (same
   publisher/item/version/sourceUrl mapping as the CLI: sourceUrl =
   `<repo>/tree/<pin>/skills/<itemId>`, changelog `imported from anthropics/skills@<pin7>`,
   manifest `{entry:'SKILL.md'}`, minimumTier basic, status published); catch `ConflictError`
   → outcome 'skipped-already-published' (the CLI's 409-skip semantic). Type
   `AnthropicImportManifest` = upstream{repo,pinnedSha} + publisher{id,name,tier,url} +
   items[{itemId,displayName,oneLineDescription,category,iconName,recommendedScope,version}]
   (shape per scripts/src/cloud/import-anthropic-skills.ts). ⚠ registry package.json needs
   `jszip` added (deps today: cloud-db/contracts/errors/drizzle-orm/zod).
2. **cloud-api**: `CloudAppOptions.anthropicManifestPath?: string`; server.ts passes
   `env.CLOUD_UPSTREAM_MANIFEST_PATH` (same manifest as the watch). Route
   `POST /admin/catalog/import-anthropic` appended to the buildAdminRoutes chain (inherits
   the requireAdminAccess dual door): absent option → `{configured:false}`; else read+parse
   the manifest, call the module, return `{configured:true, items}`. Long-running is fine
   (operator surface; the upstream-watch POST /check 5-min precedent).
3. **CLI** `cloud:import-anthropic` KEEPS its local-reviewed-checkout flow (HTTP publish)
   but imports the zip helpers from `@vynel/registry` (one home for zip logic).
4. **Portal**: `use-import-anthropic.ts` mutation (adminApiFetch POST, invalidate
   `adminCatalogKeys.all`) + a secondary "Import Anthropic items" button in CatalogView's
   `.page-header` beside "Add Marketplace Catalog"; pending label; one-line result
   ("published N · skipped M" / error via AdminApiError message).
5. **Tests**: registry test = local git FIXTURE repo (copy upstream-watch.test.ts's
   beforeAll pattern: mkdtemp + git init/config/commit `skills/<id>/SKILL.md`) + PGlite
   (`withTestCloudDatabase`) + `createInMemoryArtifactStore`; assert published catalog rows
   + stored artifact bytes + idempotent re-run → skipped. Admin route test: configured:false
   + 401 unauthenticated (heavy path lives in the registry test). Reviewer → full gate
   (Chad lets me run `pnpm test` this session) → commit
   `feat(cloud): portal-button publishing for anthropic items` → push.

## Arc 4 slice 3 — Ed25519 ARTIFACT SIGNATURES ✅ SHIPPED (`412e9ba`, 2026-08-02)

Landed per the Gate-1 design below (kept as the as-built record). Verified: contracts
round-trip/tamper + registry signed-publish/backfill + cloud-api header/sign-missing +
hub-account verify paths (42 tests in the slice); reviewer CLEAN (crypto design scrutinized —
keygen ergonomics should-fix applied; identity-binding note recorded below for the hardening
arc); **full gate GREEN (3486 passed / 620 files)**. ⚠ Chad's hub still needs the key minted
(`pnpm cloud:generate-keys`), env set, and one `POST /admin/catalog/sign-missing`.

The two formerly-open choices settled by existing precedent: ① public-key pin = **desktop env
`VYNEL_HUB_ARTIFACT_KEY`** (base64 SPKI PEM), mirroring `VYNEL_HUB_PUBLIC_KEY` (the entitlement
key already arrives this way; D2's installer bakes both) — optional, NOT gated with the hub URL
(rollout: absent = skip verification). ② existing versions = **backfill via admin route**
`POST /admin/catalog/sign-missing` (few rows exist; column stays nullable, old hubs tolerated).

Design (as implemented):

1. **Algorithm one-home: `@vynel/contracts/hub/artifact-signing.ts`** — pure node:crypto
   Ed25519 over the ASCII lowercase-hex sha256 string; `signArtifactSha256(privatePem, shaHex)
   → base64` + `verifyArtifactSha256Signature(publicPem, shaHex, sigB64) → boolean`
   (`tierMeetsMinimum` precedent for pure helpers; direct-file imports keep node:crypto out of
   browser bundles). Sign the sha, not the bytes — the desktop already recomputes the sha.
2. **Schema:** `item_versions.artifactSignature` nullable text; migration via
   `pnpm --filter @vynel/cloud-db exec drizzle-kit generate --config
   ../../drizzle.cloud-postgres.config.ts` (NEVER hand-write — memory rule).
3. **Hub:** env `CLOUD_ARTIFACT_SIGNING_PRIVATE_KEY` (optional base64Pem; absent = unsigned
   publishes, today's behavior); `cloud:generate-keys` emits the second pair (private line for
   the hub env + `VYNEL_HUB_ARTIFACT_KEY` line for the desktop env); registry `ArtifactSigner`
   (`createArtifactSigner(pem)`) → `publishCatalogArtifact(db, store, input, signer?)` stores
   the signature in `PublishArtifactFacts`; `importAnthropicItems` takes the signer too;
   `CloudAppOptions.artifactSigner?`; download route adds `x-artifact-signature` beside the
   existing `x-artifact-sha256` (from `authorizeCatalogDownload`, which reads the row anyway).
4. **Backfill:** registry `signUnsignedVersions(db, store, signer)` — signs rows with a null
   signature from stored bytes, REFUSES to sign bytes whose recomputed sha mismatches the row
   (never bless corrupt bytes; reported per-bucket, not thrown — backfill robustness);
   `POST /admin/catalog/sign-missing` behind the dual door, `configured:false` without a key.
5. **Desktop:** `HubClient.downloadArtifact` → `{ bytes, signature }` (header read);
   `CreateHubSessionOptions.artifactSigningPublicKeyPem?` — session `downloadArtifact`
   verify-if-present: signature + key present → recompute sha + verify, mismatch throws
   ValidationError; either absent → pass (rollout). local-api env `VYNEL_HUB_ARTIFACT_KEY`
   → boot wiring. Hardening to require-signatures waits until Chad's hub is backfilled.
6. **Tests:** contracts round-trip + tamper; registry signed-publish + backfill buckets;
   cloud-api download header + sign-missing route; hub-account session verify paths (valid /
   tampered / unsigned / no-key).

⚠ **For the require-signatures hardening arc** (after Chad's hub is backfilled): ① decide then
whether to bind identity into the signed message (`${itemId}@${version}\n${sha}`) — today a
signature verifies any artifact's bytes under any id, neutralized because install compares the
CATALOG-pinned sha; changing the format means re-signing every row, so decide BEFORE
`VYNEL_HUB_ARTIFACT_KEY` distributes with D2 (reviewer note, 2026-08-02). ② flip
verify-if-present to require-signatures (a stripped header currently skips the check).
- [ ] **Plugin installs → outbox/activity:** no Vynel state changes today so no event; add a
      recorded event if/when Chad wants the activity feed to show plugin installs

## Standing rules this plan inherits

- Native-disk interop: every kind lands where Claude tooling reads it (memory:
  `marketplace-native-disk-interop`)
- Credits: every resource names publisher + source with links
- Curation is the value: no firehose; pinned SHAs; human re-publish
- Migrations: drizzle-kit generate, never hand-written
- The gate is `pnpm test`; reviewer before commit; prompt Chad — never auto-commit
