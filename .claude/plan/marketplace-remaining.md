# Marketplace — remaining work plan

**Written 2026-08-01, at the close of the claude-official arc** (research → Phase A five moves →
Phase B slice 1, all shipped + smoked; commits `c3acafd`…`eb6bccb`). Full context:
`docs/module-notes/marketplace-claude-official.md` (decisions, findings, deferred rationale) +
`.claude/STATE.md`. This file is the ordered TODO; check items off as arcs land.

## Arc 1 — skills become INSTALL/UNINSTALL ONLY (decided; NEXT SESSION'S OPENER)

Chad's call (2026-08-01): a skill is one file-tree on disk — the only honest states are present
and absent. Remove the enable/disable pause state (reverses skills D11).

- [ ] Drop `installed_skills.isEnabled` — migration via **drizzle-kit generate ONLY** (memory:
      `drizzle-generate-never-handwrite-migrations`)
- [ ] Delete `enable-skill.ts` + `disable-skill.ts` (+ tests) and the two routes
      (`POST /installed/:id/enable|disable`); panel toggle in local-web; `SKILL_ENABLED_CHANGED`
      event + payload
- [ ] Remove `update-cloud-skill.ts`'s disabled guard + its test (moot without the state)
- [ ] Sweep `isEnabled` from types/serializers/schemas/views; SDK+MCP regen (pinned rosters)
- [ ] Re-check `update-skill-settings.ts` ("re-renders if enabled" → always),
      `synchronize-skills-with-provider.ts`, `list-installed-skills-for-context.ts`
- [ ] **UX:** Remove confirm must say settings are deleted (disable used to preserve them)
- [ ] Free wins: closes the pure-cloud enable-void + the enable half of template-clobber
      (both recorded in module-notes deferred)
- Scope note: skills only — agents keep their enabled state (`options.agents` resolution)

## Arc 2 — marketplace polish batch (no decisions needed; one move)

- [ ] **Update-button truth signal:** bundled-only items can show an Update the daemon 400s;
      add an explicit `updateAvailable` (or `hasCloudArtifact`) to `MarketplaceItem` and gate
      the card's `hasUpdate` on it
- [ ] **Admin portal:** Publisher column beside Kind (Chad noticed the gap); `sourceUrl` edit
      (zod line in `UpdateCatalogItemMetadataSchema` + repo patch field + form input)
- [ ] **Plugin-reader seam:** fold `marketplaceDeps.listInstalledPlugins` into the injectable
      seam (mirror `marketplacePluginDelegate`) so unmocked route tests stop reading the real
      `~/.claude/plugins`
- [ ] **Housekeeping:** shared `verifyArtifactSha256` internal (install/update dup);
      MCP tool-description refresh (mention plugins); template-clobber guard for bundled∩cloud
      ids (`installedFromSource !== 'marketplace'` gate on template re-render — partially moot
      after Arc 1)

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
