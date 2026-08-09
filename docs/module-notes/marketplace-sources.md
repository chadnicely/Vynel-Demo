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

## Deferred (named, not silent)

- `plugin marketplace update` cadence for user-added sources (the CLI refreshes its clone on
  install; a stale shelf shows stale descriptions until then).
- Session-tool exposure of source management (human-only v1).
- Structural funnel for the serverName wall (`publishItemVersion` un-export) — rides Move B.
