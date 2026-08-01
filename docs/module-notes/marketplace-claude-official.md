# marketplace — "Claude official" items: research + plan (module notes)

**Chad's ask (2026-08-01):** Anthropic publishes official plugins/skills for Claude Code. Surface
them in Vynel's marketplace labeled as Claude-official, click-to-install. This doc = the research
(what the official ecosystem actually is, verified 2026-08-01 against docs + repos) and the plan.

## 1. The official ecosystem — four sources, two item shapes

| Source (GitHub) | What it is | Consumable how |
|---|---|---|
| `anthropics/claude-plugins-official` | Anthropic's curated plugin directory, bundled into Claude Code by default (~250–300 plugins; count fluid) | `.claude-plugin/marketplace.json` |
| `anthropics/claude-plugins-community` | Community submissions passing automated validation; entries pinned to commit SHAs | marketplace.json |
| `anthropics/claude-code` | 13 example plugins (`commit-commands`, `pr-review-toolkit`, `frontend-design`, `security-guidance`…) | marketplace.json |
| `anthropics/skills` | The official Agent Skills repo — 100+ skills in category folders + spec + template | Skill folders directly, AND a marketplace.json exposing 3 plugin bundles (`document-skills`, `example-skills`, `claude-api`) |

Plus a web directory at claude.com/plugins (browse-only; submission + "Anthropic Verified" badge
pipeline).

**Two item shapes, not one:**
- A **skill** = a folder with `SKILL.md` (+ resources). Pure files. Claude Code / the Agent SDK
  discovers them from `~/.claude/skills/` and `<cwd>/.claude/skills/` — exactly Vynel's existing
  `resolveSkillsRoot` convention.
- A **plugin** = a bundle (`.claude-plugin/plugin.json`) that can carry commands, agents, skills,
  hooks, MCP servers, LSP servers, output styles. Installed by the CLI into
  `~/.claude/plugins/cache/`, recorded as `enabledPlugins` (`name@marketplace`) in settings files.

**Categories that exist upstream:**
- Plugin directory groupings: external integrations (GitHub, Linear, Notion, Figma, Slack,
  Supabase…) · dev workflows · LSP servers · output styles · security. marketplace.json entries
  carry a `category` field + keywords.
- `anthropics/skills` folders: `document-skills` (docx / pdf / pptx / xlsx) ·
  `creative-and-design` · `development-and-technical` · `enterprise-and-communication` ·
  `example-skills`.
- For Vynel's audience the relevant cut is: **document skills** (the crown jewels for
  non-technical users), creative/design, enterprise/communication, and a few integrations. LSP
  servers and dev-workflow plugins are developer-facing noise for us.

**⚠ Licensing is per-skill, not repo-wide:** example skills are Apache-2.0; **document-skills are
source-available, NOT open source**. Redistribution rights must be checked per item before we
mirror bytes through our hub. (Flagged unverified in detail — reading the actual license files is
step one of the build.)

**Marketplace metadata does NOT enumerate components.** A plugin's real contents (which commands /
hooks / MCP servers) are only discoverable from its source tree, not from marketplace.json — so a
trust-review step per curated plugin is unavoidable anyway. That is fine: curation is our value.

## 2. Install mechanics + the SDK constraint that shapes everything

- Claude Code CLI: `/plugin marketplace add <repo>` → `/plugin install name@marketplace` →
  cache under `~/.claude/plugins/cache/`, `enabledPlugins` in settings.
- **Agent SDK (`options.plugins`) accepts `{ type: 'local', path }` ONLY** — no git/marketplace
  source (verified in our installed SDK 0.3.213, `sdk.d.ts:1744`). So Vynel click-to-install must
  **materialize files on disk itself** and either pass local paths programmatically or write
  settings the SDK's `settingSources` picks up.
- Skills need no plugin machinery at all: files under the scope roots + the
  `settingSources: ['user','project','local']` we already pass = discovered. Zero new SDK surface.

## 3. Where Vynel already is (the seams exist)

- **Contract anticipated this:** `PublisherTier = 'verified' | 'anthropic-official' | 'community'`
  (`contracts/src/marketplace/marketplace-item.ts:14`) — `'anthropic-official'` is defined and
  unused. **But `HubPublisherTier = 'verified' | 'community'`** (`contracts/src/hub/catalog.ts:13`)
  — the hub tier union must widen (additive) for official items to flow through the registry.
- **`isOfficial` currently means "official Vynel"** — the bundled catalog stamps
  `publisherTier: 'verified', isOfficial: true` (`resolve-catalog-sources.ts:53,64`) and the UI's
  `BadgeCheck` renders "Official". Claude-official needs its own visual identity, keyed off
  `publisherTier === 'anthropic-official'`, distinct from the Vynel-verified badge.
- **The install pipeline is kind-complete for skills:** hub publish (`packages/registry`, kind-
  agnostic) → catalog sync (30-min ETag) → merged catalog → `installCloudSkill` (sha256 → extract
  → disk-first `SKILL.md` → row + outbox in one tx) → provider pickup via `settingSources`.
  **An official skill published to our hub installs today with zero desktop code.**
- **`category` is the one contract friction:** `SkillCategory` is Vynel-product-shaped
  (`email|documents|calendar|files|research|notes|context`). document-skills map cleanly to
  `documents`; creative/enterprise skills don't map — widen the union or add a mapping table at
  publish time.
- **`plugin` kind:** accepted by the hub registry, filtered out of desktop browse at ONE line
  (`resolve-merged-catalog.ts`), "no desktop semantics" (marketplace-kinds.md) — the Phase-B arc.

## 4. The plan

### Phase A — official skills (recommended first; small, native, high-value)

1. **License audit — DONE (2026-08-01, audited at `anthropics/skills` commit `b29e7cf`;
   actual layout is flat `skills/<name>/`, 17 skills, per-skill LICENSE.txt, no repo-root
   license):**
   - **12 × Apache-2.0** → redistributable via our hub (retain LICENSE.txt per skill, prominent
     modified-file notices if we ever patch, carry repo `THIRD_PARTY_NOTICES.md` for vendored
     deps like imageio): algorithmic-art · brand-guidelines · canvas-design · claude-api ·
     frontend-design · internal-comms · mcp-builder · skill-creator · slack-gif-creator ·
     theme-factory · web-artifacts-builder · webapp-testing.
   - **4 × proprietary HARD-NO — docx / pdf / pptx / xlsx.** Their LICENSE.txt forbids
     extraction from the Services, retaining copies outside the Services, reproduction,
     derivatives, and any distribution/sublicense/transfer to third parties. **Mirror AND
     fetch-direct are both off the table** (even the earlier fetch-direct idea dies here — Vynel
     fetching + materializing IS "extract and retain outside the Services"). The only
     possibly-defensible route is **delegate-to-official-channel**: Anthropic's own
     `.claude-plugin/marketplace.json` publishes them as the `document-skills` plugin, so Vynel
     could drive the user's own Claude Code (`claude plugin install
     document-skills@anthropic-agent-skills` after `claude plugin marketplace add
     anthropics/skills`) — distribution stays Anthropic→user under THEIR agreement; Vynel only
     orchestrates. That rides Phase B's plugin semantics (the install lands in
     `~/.claude/plugins/`, reaching Vynel sessions via `options.plugins`). Chad's call: drop for
     v1 vs. build the delegate flow.
   - **1 × unlicensed — doc-coauthoring** (SKILL.md only, no LICENSE.txt): default
     all-rights-reserved → treat as no-redistribute until Anthropic adds a license. Good audience
     fit otherwise — worth re-checking upstream occasionally.
   - Upstream bundle names (their marketplace.json): `document-skills` (the 4) ·
     `example-skills` (12 incl. doc-coauthoring) · `claude-api`.
   - **Proposed v1 allowlist (audience-fit ∩ Apache-2.0):** canvas-design (posters/visual art) ·
     theme-factory (styled slides/docs/pages) · internal-comms (status reports/announcements) ·
     slack-gif-creator (fun) · algorithmic-art (generative art, optional 5th). Skipped
     deliberately: brand-guidelines (applies ANTHROPIC's brand — misleading outside Anthropic);
     mcp-builder / webapp-testing / skill-creator / claude-api / web-artifacts-builder /
     frontend-design (developer-facing; vision says we're not a dev tool).
   - **Category widening needed:** none of the v1 picks map to the current `SkillCategory`
     union (`email|documents|calendar|files|research|notes|context`) — widen with `creative` +
     `communication` (additive contract change, parity regen).
2. **Hub:** widen `HubPublisherTier` with `'anthropic-official'`; seed an "Anthropic" publisher
   row; map through `cloud-catalog-mapper.ts` (cache already stores `publisherTier` as text).
3. **Publish pipeline:** extend the existing `pnpm cloud:publish` flow (or a
   `scripts/import-anthropic-skills` wrapper) to package a pinned-SHA checkout of an allowlisted
   skill folder → zip → publish. Pinning the SHA = our supply-chain stance: we ship a reviewed
   snapshot, upstream changes only land through a re-publish.
4. **Desktop UI:** "Claude official" badge/chip for `anthropic-official` rows (naming ties into the
   assistant-is-Claude call; exact wording = Chad). Everything else — browse, install, disk-visible
   `SKILL.md`, enable/disable — already works.
5. **Update flow** (SETTLED 2026-08-01 — Chad picked "carry the curated slice", Option 1): there is
   no free update ride from Anthropic (auto-update lives in the Claude Code CLI, not the SDK;
   skills-as-files have no native update mechanism), and installing over an existing install
   throws `ConflictError` (`install-cloud-skill.ts:68`) — **no update path exists today**. Build:
   - `updateCloudSkill` lifecycle op — sha-verify → overwrite disk → bump
     `versionInstalled`/`updatedAt` → `skill.updated` outbox event, one tx (mirrors
     `installCloudSkill`, reuses its extractor).
   - Update badge + button (`latestVersion > versionInstalled`; trigger data already lands via the
     30-min catalog sync — no new sync).
   - **Upstream-watch script**: pinned SHA vs upstream HEAD per allowlisted folder → flags
     "upstream moved" for human re-review + re-publish. Deliberately NOT auto-republish — the
     review step is the product promise. One update model for mirrored AND fetch-direct items:
     the hub always carries the metadata + sha (the update truth); only byte origin differs.

### Phase B — official plugins (fork-heavy; needs Chad's calls first)

- **Chad's interop requirement (2026-08-01) reshapes Fork 1:** installed items must land on disk
  in the **standard Claude locations** so they keep working when the user opens Claude Code (or
  Claude Desktop, where applicable) directly — Vynel installs FOR the Claude ecosystem, not into a
  Vynel-private silo. Skills already comply (`~/.claude/skills` / `<ws>/.claude/skills` IS Claude
  Code's discovery path). For plugins this flips the earlier lean: instead of a Vynel-managed root
  + programmatic `options.plugins`, materialize into Claude Code's own layout
  (`~/.claude/plugins/...`) + write `enabledPlugins`/`extraKnownMarketplaces` into
  `~/.claude/settings.json`. **VERIFIED (2026-08-01): the SDK does NOT load settings-declared
  plugins** — SDK plugin docs show only `options.plugins` with `type: 'local'`; `settingSources`
  auto-loads skills/agents/settings but not plugins (inferred from doc absence, not an explicit
  statement — worth one runtime smoke test when Phase B starts). So the shape is **one
  materialized copy, referenced twice**: the native layout + settings entry makes it work in the
  Claude Code CLI; Vynel sessions pass the same folder's path via `options.plugins` in
  `buildClaudeSdkOptions`. Coupling to Claude Code's layout is now a feature, not a bug.
- **Claude Desktop — VERIFIED (2026-08-01): NOT covered by disk installs.** Anthropic's Agent
  Skills docs state custom skills do not sync across surfaces; Claude Code skills are
  filesystem-based and separate from claude.ai/Desktop/API. Desktop reads only
  `claude_desktop_config.json` (MCP servers, per-OS app-config dir — Windows:
  `%APPDATA%\Claude\`), never `~/.claude/skills` or `~/.claude/plugins`. **The honest interop
  promise is "works in Claude Code."** A Desktop bridge = writing MCP entries into
  `claude_desktop_config.json` (MCP-kind arc could cover both configs); skills cannot be bridged
  to Desktop by files at all (gallery upload only).
- **Fork 2 — trust floor:** plugins can carry hooks and MCP servers. V1 allowlist = plugins whose
  bundle is commands/skills/agents only; MCP-bearing plugins wait on the `mcp`-kind ownership +
  carding forks (marketplace-kinds.md) — most official *integration* plugins are MCP-shaped, so
  Phase B's interesting half is entangled with that arc by construction.
- **Never** the firehose: we do not mirror 250+ plugins. Hand-picked, reviewed, pinned — per the
  vision non-goal ("no free-for-all marketplace — curation is the value").

## 5. Open decisions for Chad

1. ~~Curation list v1~~ — **SETTLED (2026-08-01): all five** — canvas-design · theme-factory ·
   internal-comms · slack-gif-creator · algorithmic-art.
2. ~~Document-skills call~~ — **SETTLED (2026-08-01): delegate to the Claude CLI.** Chad's
   framing: Vynel runs Claude Code via the Agent SDK — the user's own Claude Code installs
   Anthropic's `document-skills` plugin from Anthropic's own marketplace
   (`claude plugin marketplace add anthropics/skills` → `claude plugin install
   document-skills@anthropic-agent-skills`). Anthropic→their-user via their tooling; Vynel
   never hosts bytes, it orchestrates. Its own arc (needs: CLI/bundled-binary invocation from
   the daemon, install detection, and the `options.plugins` cache-path attach for Vynel
   sessions — plus the Phase-B smoke test on settings-declared plugins).
3. ~~Distribution channel~~ — **SETTLED (2026-08-01): hub-published, Option 1** ("carry the
   curated slice"); update spine = hub re-publish + upstream-watch script (see Phase A §5).
4. ~~Badge wording~~ — **SETTLED (2026-08-01): "By Anthropic"** (plain provenance, no implied
   endorsement), keyed off `publisherTier === 'anthropic-official'`; Vynel's own badge stays
   "Official".
5. **Phase B timing:** start after Phase A, or park until the `mcp`-kind forks are decided
   (recommended: park; Phase A alone delivers the visible win). The document-skills delegate
   arc (decision 2) is the likely Phase-B opener.

## Phase B Gate-1 findings (probed live on Chad's machine, 2026-08-01)

- **The Agent SDK bundles a full `claude.exe`** (platform package
  `@anthropic-ai/claude-agent-sdk-win32-x64`, v2.1.213) with the COMPLETE `plugin` command
  suite: `install|i <plugin>@<marketplace>` (`--scope user|project|local`, `--config`),
  `uninstall`, `update`, `enable/disable`, `marketplace add`, `list`, `validate`, `details`.
  → Non-technical users need NO standalone CLI; Vynel drives the bundled binary.
- **The real disk contract (registry v2, read from Chad's `~/.claude/plugins/`):**
  - `installed_plugins.json` — `{version: 2, plugins: {"<name>@<marketplace>": [{scope,
    projectPath?, installPath: cache\<mkt>\<name>\<version>, version, installedAt,
    gitCommitSha}]}}` (the INSTALL registry).
  - `known_marketplaces.json` — `{"<name>": {source: {source: 'github', repo}, installLocation:
    marketplaces\<name>, lastUpdated}}`.
  - Marketplace clones: `plugins/marketplaces/<name>/`; plugin copies:
    `plugins/cache/<marketplace>/<plugin>/<version>/`.
  - **Enablement lives separately** in `~/.claude/settings.json` `enabledPlugins`
    (`"name@marketplace": true`) — which Vynel's `settingSources: ['user',...]` already loads.
- **✅ SMOKED (Chad, 2026-08-01): NATIVE PICKUP WORKS.** A Vynel workspace session answered
  "do you have a frontend-design skill?" with the plugin-provided skill by name — SDK-spawned
  sessions auto-load user-scope CLI-installed+enabled plugins (the bundled binary owns the
  machinery + reads the same settings/registry). **Zero session wiring needed**; the
  `options.plugins` contingency is dead. (A session already running at install time picks the
  plugin up on its next session start — note in UI copy if users get confused.)

## Phase B slice 1 — document-skills via CLI delegate (✅ SHIPPED `284315b` + SMOKED, 2026-08-01)

**Chad's end-to-end smoke passed:** Documents Pack published from the seed bundle → Get in the
app's global marketplace → the bundled-CLI delegate registered anthropics/skills + installed
document-skills → the doc skills work in Vynel sessions (and in Claude Code directly — same
native install). Review hardening landed with the slice: plugins forced to user scope
structurally (never on the workspace MCP tool), marketplace repo-mismatch refusal, malformed-key
uninstall guard. Original plan below.

1. **Provider seam `ClaudePluginCli`** (`packages/providers/src/claude/installation/`): locate
   the bundled `claude.exe` (platform-package resolution + env override), `execFile` the plugin
   commands (`marketplace add anthropics/skills`, `install document-skills@anthropic-agent-skills
   --scope user`, `uninstall`), and read/parse `installed_plugins.json`. Runtime-in-providers
   invariant holds — driving the engine binary is provider territory.
2. **Marketplace `plugin` kind goes live:** `MarketplaceItemKind` widens to
   `'skill' | 'agent' | 'plugin'`; `resolve-merged-catalog` passes plugin rows; install/uninstall
   dispatch gains a plugin branch that calls the injected delegate (NO artifact download — the
   item's `manifestJson` carries `{marketplaceRepo, marketplaceName, pluginName}`); the app
   injects the provider seam through `MarketplaceDeps` (leaf never imports providers).
3. **Hub item:** publish `document-skills` (kind `plugin`, category `documents` — fits the
   existing union, publisher `anthropic-official`, sourceUrl → the pinned folder) with a tiny
   descriptor-only artifact (the publish schema requires bytes; the desktop never downloads it).
4. **Install-status:** annotator keys plugins on `name@marketplace` via an injected
   `listInstalledPluginKeys` reader (same recipe as agents' slug reader).
5. **Native-disk interop + Chad's disk-visibility rule: satisfied BY CONSTRUCTION** — the CLI
   itself writes the native layout; Claude Code direct use sees exactly the same install.
6. **Trust floor:** `document-skills` bundles ONLY the four document skills (verified from its
   marketplace.json — no hooks, no MCP servers); installs still card via the existing
   `install_marketplace_item` mutating tier. Hook/MCP-bearing plugins stay browse-filtered.
7. **UI:** "Plugin" kind chip; Get/Remove drive the delegate; update-flow defers to
   `plugin update` in a later slice. No enable/disable toggle v1 (install = enabled, matching
   the skills install/uninstall-only direction).

## Move 3+ build queue (post-decisions, 2026-08-01)

- **Move 3 — full-folder skill artifacts (prerequisite):** all five allowlisted skills are
  multi-file folders (canvas-design ships a 5.6 MB font library; theme packs, Python helpers,
  JS templates) but the install path extracts ONLY SKILL.md — installing them today ships
  broken skills. The extractor grows per-entry traversal/absolute/symlink guards (its header
  reserved exactly this); the disk writer becomes stage-and-swap so an update never leaves a
  half-written folder. All five fit the hub's 10 MB artifact cap.
- **Move 4 — publish pipeline + credits + badge:** import script (pinned-SHA clone → zip each
  allowlisted folder faithfully, licenses ride along → `cloud:publish` under publisher
  `anthropic` / `anthropic-official`), `SkillCategory` widening (`creative` + `communication`),
  the "By Anthropic" chip.
- **Credits requirement (Chad, 2026-08-01): every marketplace resource credits its origin** —
  publisher identity + git/website with as much detail as available. `publisherName`/
  `publisherUrl` already ride the wire but the card never shows them; add a per-item
  `sourceUrl` (hub column + cache + contract, e.g. the pinned
  `github.com/anthropics/skills/tree/<sha>/skills/<id>` folder) and render a credit line
  (publisher link + source link) on the card/detail. Applies to ALL items, not just Anthropic's.
- **Move 5 — upstream-watch script** (pinned SHA vs upstream HEAD → flag for re-review).

## Deferred (named, not silent — from the Phase-B slice-1 review, 2026-08-01)

- **Installed-plugins reader seam asymmetry:** the delegate is injectable via `CreateAppOptions`
  but `marketplaceDeps.listInstalledPlugins` binds the real registry reader — unmocked route
  tests read the dev's real `~/.claude/plugins` (harmless today: only plugin-kind items with a
  matching full key annotate; `user-scoped.test.ts` mocks it). Fold the reader into the
  injectable seam on next touch so no route test touches the real home dir.
- **Plugin installs emit no outbox event** — no Vynel DB state changes (Claude Code's registry
  is the source of truth), so invariant 8 doesn't bite; name it when an activity-feed consumer
  needs install events.
- **MCP tool description drift:** `install_marketplace_item` says "a skill or agent" /
  "artifacts integrity-verified server-side" — still literally accurate (plugins are structurally
  user-scope → global surface → no MCP), but fold a plugin mention into the next regen touch.
  If plugins ever ride MCP, that's a Chad call and belongs in the askApproval tier
  (external-binary execution).
- **`ValidationError` for CLI/binary failures** is semantically stretched — revisit if
  `@vynel/errors` grows a provider/engine error class.

## Deferred (named, not silent — from the Move-2 review, 2026-08-01)

- **Bundled-only Update-button truth gap:** `hasUpdate` fires on any installed skill whose
  `versionInstalled !== item.version`, but a bundled-only item (no cloud cache row) 400s at the
  daemon ("no cloud version to update to") — error surfaces on the card, not silent, but it's the
  dead-button pattern the merge avoids. Honest fix = an explicit wire signal (`hasCloudArtifact`
  or daemon-computed `updateAvailable`) on `MarketplaceItem`.
- **Template-clobber drift class (pre-existing, widened):** for an id that is BOTH bundled and
  cloud, `enableSkill` / `updateSkillSettings` re-render SKILL.md from the bundled template over
  marketplace bytes while the row keeps the cloud `versionInstalled`. Follow-up: gate template
  re-render on `installedFromSource !== 'marketplace'` (or persist extracted markdown).
- **sha-verify duplication:** the hash-compare block is verbatim in `install-cloud-skill.ts` and
  `update-cloud-skill.ts` — extract a shared `verifyArtifactSha256` internal on next touch.
- **Admin portal catalog table shows no publisher column** (Chad noticed 2026-08-01) — kind
  says "skill" but nothing marks Anthropic provenance portal-side; add Publisher beside Kind on
  the portal's next touch (same touch as the `sourceUrl` edit gap below).
- **Admin portal can't edit `sourceUrl` (from the Move-4 review):** the publish composable type
  carries it but `PublishItemView` has no form field and `UpdateCatalogItemMetadataSchema` omits
  it — a wrong credit URL today needs a script republish with a version bump. Close on the
  portal's next touch (zod line + repo patch field + form input).
- **Pure-cloud enable-void (pre-existing, from the Move-3 review):** `enableSkill`
  re-materializes only from the bundled catalog — for a marketplace-only skill it flips the flag
  with NOTHING written to disk (recoverable via sync → repair-update). Moot if the
  skills-install/uninstall-only arc removes enable/disable first; otherwise fix alongside the
  template-clobber item above.

**Standing requirement (Chad, 2026-08-01): native-disk interop.** Every installed item lands in
the standard Claude ecosystem location so it works when the user runs Claude Code directly —
extends the disk-visibility rule (marketplace-kinds.md §"Disk visibility") from "user can SEE it"
to "native Claude tooling can USE it". Any new kind's arc must name its native location before
landing.
