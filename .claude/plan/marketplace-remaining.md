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

## Arc 3 — the last catalog kinds (NEED CHAD'S CALLS first)

- [ ] **`mcp` kind** — two recorded forks (docs/module-notes/marketplace-kinds.md): which leaf
      OWNS a standalone MCP install (today MCP config writes are a skills-internal side effect),
      and does a standalone "add a server" install CARD. Desktop bridge option: write BOTH
      `~/.claude.json` (Claude Code) and `claude_desktop_config.json` (Claude Desktop)
- [ ] **`rule` kind** — waits on the instructions-notebook leaf as its install target
- [ ] **Plugin updates** — small slice: `claude plugin update` delegate + registry re-read
      (today: uninstall/reinstall)
- [ ] **More official plugins** — machinery ships anything now; each addition = curation +
      trust review. OPEN CALL: hooks/MCP-bearing plugins should likely require the askApproval
      tier (external code execution) before any rides an MCP tool

## Arc 4 — operations & production hardening (someday, before real users)

- [ ] **Upstream-watch automation:** schedule `pnpm cloud:check-anthropic` (cron/schedules leaf)
      + notify on drift; manual today. Re-pin recipe prints in its output
- [ ] **Hub production track** (deferred from M4a, module-notes cloud-api): R2 object storage
      move + per-artifact Ed25519 signatures (separate key from the token key) ·
      `minAppVersion` enforcement (needs D2 installer stamping real versions) · real mail
      sender (dev logs password links) · portal publishes official items (today CLI-only)
- [ ] **Plugin installs → outbox/activity:** no Vynel state changes today so no event; add a
      recorded event if/when the activity feed should show plugin installs

## Standing rules this plan inherits

- Native-disk interop: every kind lands where Claude tooling reads it (memory:
  `marketplace-native-disk-interop`)
- Credits: every resource names publisher + source with links
- Curation is the value: no firehose; pinned SHAs; human re-publish
- Migrations: drizzle-kit generate, never hand-written
- The gate is `pnpm test`; reviewer before commit; prompt Chad — never auto-commit
