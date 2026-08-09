# marketplace — sources: user-added Claude marketplaces + admin-hub aggregation (module notes)

**The ask (Kafi, 2026-08-09):** users can add third-party marketplaces (each carrying many
plugins/skills) that surface in the marketplace behind a source filter; Vynel's cloud admin can
register external marketplaces, verify items one by one, and approve them into the official
catalog. Settled calls: v1 third-party format = **Claude-native `.claude-plugin/marketplace.json`
only**; MCP-auth lane shipped first (same branch, `feature/marketplace-mcp-auth`).

## Probe findings (2026-08-09, bundled claude.exe 2.1.213, scratch `CLAUDE_CONFIG_DIR`)

- `plugin marketplace add|list|remove|update` all exist. **The `owner/repo` shorthand fails
  without auth state ("access rights") — the https `.git` URL form clones reliably**; normalize
  user input to it. ⚠ A deep config dir breaks checkout on Windows (MAX_PATH); the real
  `~/.claude` is short — not a production concern.
- Disk contract (the machine surface; `list` output is human text): `plugins/
  known_marketplaces.json` = `{ "<name>": { source: {source:'git', url}, installLocation,
  lastUpdated } }`; the clone at `plugins/marketplaces/<name>/` carries
  `.claude-plugin/marketplace.json` = `{ name, owner{name,email}, metadata{description,version},
  plugins: [{ name, description, source, strict?, version?, category?, skills?[] … }] }`.
- Registration also lands in user settings ("declared in user settings") — the CLI owns both
  writes; Vynel only drives the CLI (delegate-to-native, the plugin/mcp-auth precedent).

## The design shrink (re-derived from structure — the monolith-blockers memory pattern)

The research phase's four "hard blockers" assumed every source flows through
`marketplace_cloud_catalog`. Claude-native marketplaces are **config-is-truth on Claude's own
files** — read live via injected readers, never cached in our table. Consequences:
- Cache PK / full-table-wipe sync: **untouched** (the cache stays hub-only).
- Item identity: third-party items are kind `plugin` with `itemId = <plugin>@<marketplace>` (the
  pluginKey) — globally unique by construction (hub ids are kebab, `@` is impossible).
- Badging: our mapper stamps third-party rows `publisherTier: 'community'`, `isOfficial: false`
  by construction — no origin-derivation rework needed for v1 (the hub stays the trusted door).
- serverName rule: third-party sources carry plugins, never standalone `mcp` rows; the hub wall
  (Slice 4) covers the only mcp publisher.
- Install/uninstall/update/annotation: the EXISTING plugin delegate + pluginKey matching serve
  third-party items unchanged — a registered marketplace's `install name@marketplace` already
  works.

## Move A — source dimension + user-added marketplaces (desktop)

1. **Providers** (claude-plugin-cli siblings): `addClaudeMarketplace(sourceUrl)` /
   `removeClaudeMarketplace(name)` driving the CLI; readers
   `listKnownClaudeMarketplaces()` (known_marketplaces.json → `{name, sourceUrl, lastUpdated}`)
   and `readClaudeMarketplaceCatalog(name, installLocation)` (the clone's marketplace.json,
   lenient — a broken clone answers empty, never throws).
2. **Contract**: `MarketplaceItem.source: { kind: 'vynel-catalog' } | { kind:
   'claude-marketplace'; marketplaceName: string }` (bundled + hub = vynel-catalog). Third-party
   mapping: displayName = plugin name, publisher = marketplace owner.name, sourceUrl = the git
   URL, category = entry.category ?? 'plugins', version = entry.version ?? metadata.version ??
   '0.0.0', scope forced 'user' (the plugin posture — off the workspace surface and its tool).
3. **Marketplace leaf**: merge gains the third source via an injected reader (leaf never touches
   disk); pluginKey annotation covers install state for free.
4. **Routes** (global surface only, human-management posture — NO x-mcp; adding a marketplace is
   a trust decision): `GET /marketplace/sources`, `POST /marketplace/sources` (normalize
   owner/repo → https .git URL; delegate add), `DELETE /marketplace/sources/:name` (delegate
   remove). Registered-elsewhere name conflicts surface as the delegate's typed error.
5. **UI** (global MarketplaceSection): source filter chips (Vynel + one per marketplace);
   "Marketplaces" manage dialog — list + remove + add form with the trust warning (plugins can
   carry hooks and MCP servers; add only sources you trust). Third-party cards show the
   marketplace name in the credit line.

## Move A as built (2026-08-09)

- **Providers** `claude-marketplace-cli.ts` (plugin-CLI sibling, shares its runner):
  add/remove drive the CLI (empty/dash argv guard); `listKnownClaudeMarketplaces` maps BOTH
  registration shapes (`git.url` / `github.repo`); `readClaudeMarketplaceCatalog` reads the
  clone's marketplace.json leniently (per-plugin version falls back to metadata.version).
- **Contract** `MarketplaceItem.source` (REQUIRED): `{kind:'vynel-catalog'}` (bundled + hub) |
  `{kind:'claude-marketplace', marketplaceName}`. Third-party rows: itemId = pluginKey,
  community tier, owner-credited, `package` icon (monogram fallback), scope forced 'user'.
- **Leaf** `claude-marketplace-items.ts` mapper + merge APPENDS after bundled∪cloud with a
  never-override guard (pinned: a hostile marketplace.json claiming `email-drafter` as a plugin
  name lands under its own `email-drafter@<mkt>` id — the bundled row untouched).
- **App**: `claudeMarketplacesReader` injectable (unreadable marketplaces list with zero plugins
  — the manage list must show them so the user can remove); `MarketplaceDeps` +
  `marketplaceDepsWith` gained the reader; third-party plugin installs build the delegate
  manifest FROM THE ROW (marketplace already registered; no hub cache involved); uninstall/
  update ride the pluginKey machinery unchanged.
- **Routes** `/marketplace/sources` (global, human-only — NO x-mcp: a session must never
  register a source of executable plugins): list / add (owner-repo → https .git normalization,
  https-only) / remove (arm-confirmed in UI). SDK 247→250, tool count 84 unchanged, parity 4/4.
- **UI**: source chips (render only when a third-party source contributes rows; All/Vynel/per-
  marketplace), Marketplaces manage dialog (trust warning: plugins can run code and connect
  tools; community-marked, never verified), clearFilters resets the source too.
- Green: marketplace leaf 66 · marketplace routes+sources 43+ · local-web 562 (31 section + 2
  dialog) · providers 32 · typechecks across the workspace · parity 4/4.

## Move A review round (1 must-fix + 4 should-fixes, ALL applied)

- **Must-fix:** the repo-mismatch guard compared the RAW registered ref against the rendered
  https URL, so a shorthand-registered marketplace refused installs against itself — fixed with
  `canonicalMarketplaceRef` (owner/repo ≡ https URL ≡ .git/slash variants; the test caught a
  strip-order bug too), the guard now reads BOTH registration shapes, and a blank caller-side
  ref skips the check (the registration is the anchor). Pinned with real-guard tests over a
  fixture registry (guard-pass proceeds to a `process.execPath` exec whose distinct failure
  message proves the mismatch never fired).
- Should-fixes: ① dash-leading plugin/marketplace names refused in ALL provider plugin commands
  (hostile marketplace.json names are argv now) ② credential-bearing https URLs refused at the
  sources route (would persist into Claude's registry + the log) ③ shelf filter state extracted
  to `use-marketplace-shelf-filters.ts` (section 381→337 lines) ④ the reader's
  unreadable-source semantic pinned (`claude-marketplaces-reader.test.ts`).
- Deferred (named): a marketplace self-named `vynel`/`all` aliases the chip sentinels
  (cosmetic — cards still badge community); the add route's 201 fallback row warrants a live
  smoke; section file still slightly over the soft ceiling (template-dominated).

## Move B — admin-hub aggregation (portal review queue)

Registry: register an external marketplace repo (pinned SHA, the git-fetch home) → parse its
marketplace.json → per-plugin review rows → admin approves selected → publish as kind `plugin`
items with delegate-descriptor manifests (`{marketplaceRepo, marketplaceName, pluginName}` — the
document-skills shape), publisher = the marketplace owner. Upstream-watch extends to registered
repos. Open for Chad: what badge an admin-approved third-party plugin carries (leaning:
`community` tier, no Official badge — approval means available, not endorsed).

## Move B as built (2026-08-09)

- **Registry** `claude-marketplace-import.ts`: `inspectClaudeMarketplaceRepo` (STATELESS review
  material — github URL wall → clone at HEAD via the repo-source lifecycle → parse
  marketplace.json → plugins with `proposedItemId` (kebab-folded `<marketplace>-<plugin>`) +
  `alreadyPublished`); `importClaudeMarketplacePlugins` publishes the approved subset as
  delegate-descriptor `plugin` items (document-skills shape: manifest
  `{marketplaceRepo, marketplaceName, pluginName}`, descriptor-only artifact, publisher =
  marketplace owner at **community tier — approval means available, never endorsed**, sourceUrl
  pinned `/tree/<sha>`; ConflictError → skipped; unfoldable names → invalid-name). Tests over a
  real git fixture + PGlite, incl. desktop-parser compatibility and the URL-wall-before-git pin.
- **cloud-api**: `POST /admin/catalog/inspect-claude-marketplace` + `/import-claude-marketplace`
  behind the dual door (import-anthropic precedent; long-running acceptable).
- **Portal**: `ImportMarketplaceView` (`/catalog/import-marketplace`, door in CatalogView) —
  inspect → checkbox review list (already-published rows unticked) → Approve N → outcome
  summary; view test pins the preselect + exact approved payload. "Add Marketplace Catalog"
  label left as-is (deliberate earlier rename, not a mislabel).
- **Desktop needs NOTHING**: hub-published delegate plugin items already install (document-
  skills precedent) and badge community.
- Green: registry marketplace-import 3 (registry total 89) · cloud-api 29 · portal 24.

## Move B review round (1 must-fix + 5 should-fixes, ALL applied)

- **Must-fix:** publisher-id collision — a marketplace self-named "Anthropic" folded to the
  production `anthropic` publisher id, and one approval would have DEMOTED the official
  publisher (name/tier/url upsert) across every Anthropic item. Fixed by namespacing:
  `marketplacePublisherId` = `mkt-<folded>` (pinned in the publish test).
- Should-fixes: ① the real `PublishItemSchema` now runs per item at import (semver + bounds
  invariants are no longer type-only on this path; failures fold to 'invalid-metadata' with a
  bounded `detail`) ② per-item try/catch — store/DB hiccups land as 'failed' outcomes with
  detail, never aborting the batch (re-runs converge via skip) ③ inspection truncates every
  field to publishable bounds + folds blanks to null, so "Approve N" can't dead-end on one
  oversized hostile description ④ inspection dedupes plugin names + caps at 100 entries and the
  already-published flags batch into ONE query ⑤ `sourceUrl` derives via the existing
  `deriveRepoSourceUrl` home (trailing-slash/.git variants normalized).
- Deferred (named): repo-inspect size caps (~5MB stat sweep across ALL repo-inspect paths, not
  just this one); malformed-vs-missing marketplace.json both report not-found; cross-marketplace
  folded item-id aliasing (deterministic, admin-reviewed); post-import inspection staleness
  (cosmetic — re-approve skips).

## Deferred (named, not silent)

- `plugin marketplace update` cadence for user-added sources (the CLI refreshes its clone on
  install; a stale shelf shows stale descriptions until then).
- Session-tool exposure of source management (human-only v1).
- Structural funnel for the serverName wall (`publishItemVersion` un-export) — rides Move B.

## Move C — workspace-scope plugins (Kafi's call, 2026-08-09; rationale: context tokens)

A user-scope plugin surfaces its skills/commands into EVERY session's context; workspace-scope
confines that cost to where it's wanted. Natively supported: `claude plugin install --scope
project` + cwd (registry entries carry `{scope:'project', projectPath}`). Design:
- Provider: `runPluginCommand` gains cwd; install/uninstall/update gain
  `installScope: 'user'|'project'` + workspacePath (project → `--scope project` + cwd);
  `listInstalledClaudePlugins` emits scope + projectPath (user entries + per-project entries).
- Surfacing: plugin rows become scope 'both' (hub mapper + third-party mapper); surface-decides-
  scope (memory rule): workspace shelf installs project-scope, global installs user-scope.
- Annotation: per-surface plugin reader (mcpServersReaderFor recipe) — global = user entries;
  workspace = user ∪ project entries with normalized projectPath == workspace.path; annotator
  prefers the workspace match (D12).
- **The structural wall stays**: plugin installs now require body field
  `acceptPluginExecution: true`, excluded from the session tool schema via
  `x-mcp.excludedBodyFields` (the mcpConfigurationValues mechanism) — a session's install of a
  plugin arrives without it and gets an actionable 400; the UI always sends it. This preserves
  the recorded invariant (the non-carded tool can never run the CLI delegate) while widening
  the UI surface.

## Move C as built (2026-08-09)

Provider: `ClaudePluginInstallScope` ('user' | 'project'+workspacePath) threads through
install/uninstall/update (`--scope project` + cwd); the registry reader emits user AND
project entries with projectPath. App: `pluginsReaderFor(workspace, providerReader)` narrows
per surface (user always; project entries whose normalized path == the workspace's);
annotator prefers the workspace match (D12); plugin rows surface 'both' (hub + third-party
mappers). The structural wall moved to `acceptPluginExecution` (excluded from the session
tool schema — tool-shaped installs 400 actionably, pinned e2e; the UI click is the consent).
Update re-reads the registry scope-aware. Suites: providers 37 · marketplace 66 · routes 44
· section 32; parity 4/4.

## Move C review round — must-fix applied: the wall covers ALL plugin verbs

The reviewer caught that flipping plugins to scope 'both' quietly opened plugin UPDATE (which
pulls new publisher code) and UNINSTALL to the workspace session tools. `acceptPluginExecution`
now gates all three verbs — bodies + `excludedBodyFields` on install/update/uninstall tools,
UI verbs send it, gates sit in every plugin lifecycle body — pinned by the tool-shaped-400
e2e. Also applied: provider project-entry newest-wins dedupe per (key, projectPath);
update re-read matches THIS workspace's projectPath (never another workspace's twin); shared
provider view type; tool descriptions say plugins are Marketplace-panel-only; normalization
variant (case + trailing slash) exercised in the e2e.
