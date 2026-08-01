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
      · per-artifact Ed25519 signatures — implementable now (own arc; separate key from the
        token key; hub signs at publish, desktop verifies at download)
      · `minAppVersion` enforcement — BLOCKED on D2 installer stamping real versions
      · real mail sender — BLOCKED on Chad's provider choice + API key (dev logs links today)
      · portal publishes official items — implementable now (portal trigger for the
        import-anthropic pipeline; today CLI-only)
- [ ] **Plugin installs → outbox/activity:** no Vynel state changes today so no event; add a
      recorded event if/when Chad wants the activity feed to show plugin installs

## Standing rules this plan inherits

- Native-disk interop: every kind lands where Claude tooling reads it (memory:
  `marketplace-native-disk-interop`)
- Credits: every resource names publisher + source with links
- Curation is the value: no firehose; pinned SHAs; human re-publish
- Migrations: drizzle-kit generate, never hand-written
- The gate is `pnpm test`; reviewer before commit; prompt Chad — never auto-commit
