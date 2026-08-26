# Claude config — rules · commands · skills · agents (module notes)

**Kafi's ask (2026-08-26):** finalize the four `.claude/` areas to production grade — the user
(UI) AND Claude (MCP) can create, edit, delete each kind; on-disk files are auto-discovered
consistently ("some are discovered and registered, some aren't"). Skills may be multi-file.
Worktree: `.claude/worktrees/claude-config` (`feature/claude-config`, band 18940).

**Kafi's decisions (same day):** no new DB tables — work the disk directly for rules / commands /
hand-authored agent files ("the issue is how we detect if they're installed from the
marketplace" → the existing markers answer that: the rule marker line, the agent mirror marker,
the skills row); mirror every agent source on disk; per-kind tools with descriptive names.
Claude may also write these files natively (Write/Edit in a workspace session) — discovery picks
them up on the next list — but the dedicated tools are the correct door for the global scope,
for marker/mirror safety, and for the approval card.

## Where each kind stood (four-agent audit, 2026-08-26)

| Kind | Truth | Discovery of hand-authored files | User CRUD | Claude (MCP) | Bugs found |
|---|---|---|---|---|---|
| Rules `.claude/rules/*.md` | disk (config-is-truth, marketplace marker) | live flat scan — listed | read-only viewer | none (marketplace install/uninstall only) | lister accepted any `.md` name, writer/remover only kebab |
| Commands `.claude/commands/**/*.md` | disk | live recursive scan — listed | list only, **no body read**, no menu count | none | — |
| Skills `.claude/skills/<id>/SKILL.md` + files | folder; DB row = bookkeeping (health, settings) | `synchronizeSkillsWithProvider` inserts `external` rows — **never called** (CLI only) | read-only list | catalog install/uninstall only | uninstall recomputed the folder from `skillId` instead of `installLocation`; a hand-authored skill whose frontmatter `name` = a catalog id flipped the Marketplace card (uninstall would delete the user's folder); `updateSkillSettings` committed the row before rendering disk (D8 inverted) |
| Agents | DB row; marker-stamped mirror on disk for curated/community only | **none** — `.claude/agents/code-reviewer.md` in this very repo is live in sessions and invisible to Vynel | list + On/Off only (Claude has 8 tools, the human has none) | full CRUD | user-built agents write no mirror (`createAgent` silently shadows a colliding hand-authored file, and un-shadows it on disable); stale "every route is x-mcp" header |

## The model (built)

**Files are the truth; the DB indexes only what needs state.** Rules and commands carry no state
beyond the file → no table. Skills keep their row (health + settings live there) and the row set
is reconciled with disk on **every shelf read** (`listInstalledSkillsSynced` — the sync writes
only when a row's health changed, so a list never turns into a write per row; the provider scans
the skills leaf's own home seam via `DiscoverSkillsInput.userHomeDir`, so route tests never touch
the developer's real `~/.claude/skills`). Agents keep the DB row for Vynel-managed agents (now mirrored on disk whatever their source)
and the hand-authored files beside them stay files, listed and edited raw.

- **Yours vs managed.** The existing markers separate the user's own files from Vynel-written
  ones (rule marker line, agent mirror marker, the skills row's `installedFromSource`). Editing a
  marketplace rule in Vynel strips the marker → the file becomes yours (the card reads "not
  installed"; reinstall = reset). The marketplace skill card matches **catalog-sourced rows only**
  (`verified-catalog` | `marketplace`) — a discovered (`external`) or Vynel-written (`user`) skill
  whose frontmatter name equals a catalog id never flips the card.
- **Naming — one predicate per kind, shared by the lister AND the writers** so a row the view
  shows is always a file the doors can reach: `isSafeFileStem` (one path segment: no separators,
  no `..`, no leading dot, no control bytes, **no Windows-reserved `<>:"|?*`** — a colon writes an
  NTFS alternate data stream that never lists) for rules and each `:`-separated command segment
  (`git:commit` ↔ `git/commit.md`, ≤ 5 segments); skill ids are kebab (`SAFE_SKILL_ID`); skill file
  paths follow the hub archive rules (`archiveEntryPathViolation`) plus no hidden names, ≤ 6 deep,
  and `SKILL.md` spelled exactly (a case variant is the entry file on Windows/macOS).
- **Rows carry what the editor edits:** rules `body` (marker-free), commands `body` (after the
  frontmatter — the leaf parses; the web never re-parses), commands keep unmodelled frontmatter
  keys (`allowed-tools`, `model`…) across a save.
- **Skills are folders.** `create_skill {skillId, scope, description, body}` renders a loadable
  SKILL.md (`name` = folder, `description` present) and inserts a `user` row; `write_skill_file`
  adds/updates any text file (SKILL.md writes are re-validated as loadable); `delete_skill_file`
  refuses SKILL.md (that is uninstall); `uninstall_skill` removes folder + row. The folder always
  comes from the row's `installLocation`, contained inside the scope root
  (`resolveInstalledSkillFolder` — a corrupted row throws instead of deleting elsewhere).
- **Routes — the `/agents` shape.** Top-level mounts take `{ scope, workspaceId? }` (ambient stamp
  on workspace turns; `resolveScopeTarget` is the one home for the pairing + ownership 404) so ONE
  tool name serves the global root and a workspace conversation; the workspace-prefixed GETs stay
  for the menus. `GET /commands/resolved` replaced the workspace-prefixed one (one resolved read).
- **MCP.** Path A, `rootSurface` + `workspaceInteractiveSurface` only — background / delegated /
  schedule turns never rewrite standing config. Every DELETE cards in ask mode; `write_rule` opts
  into the ask tier too (a rule changes every future session). Tools: `list_rules` `write_rule`
  `delete_rule` · `list_commands` `write_command` `delete_command` · `create_skill` `get_skill`
  `write_skill_file` `delete_skill_file` `uninstall_skill`.
- **UI.** Notebook-shaped dialogs (`WriteRuleDialog`, `WriteCommandDialog`, `WriteSkillDialog`),
  the armed "Sure?" delete on every row, a menu count for commands, and `EditSkillFilesDialog` —
  file list + `CodeEditor` per file, save per file, add file (folders via `/`), delete a
  supporting file; binary files listed, never opened.

## Slices

1. ✅ **Rules** — `writeOwnRuleFileForScope` / `deleteOwnRuleFileForScope` / `readRuleFileForScope`
   / `stripRuleFileMarker` · `GET /rules/resolved`, `PUT|DELETE /rules/:ruleId` · UI New/Edit/Delete.
2. ✅ **Commands** — `command-file-frontmatter` (parse/render, extra keys kept), write/delete ops,
   `countCommandsForScope` (menu badge), `readCommandFileForScope` · top-level `/commands`
   resolved/write/delete · UI view dialog + New/Edit/Delete.
3. ✅ **Skills** — the three bug fixes · sync-on-list (+ the count) · `createOwnSkill` + the
   `skill-files/` doors · `'user'` source · five tools · UI New skill + multi-file editor + Uninstall.
4. ✅ **Agents** — `createAgent` is now the mirror-writing choreography for EVERY source
   (`createAgentRow` is the row half; a colliding hand-authored file is refused before any DB
   touch) · the hand-authored files (`.claude/agents/*.md` without the mirror marker) stay files:
   `listFileAgentsForScope` / `writeFileAgentForScope` (loadable frontmatter, refuses a mirror
   path or a slug Vynel owns) / `deleteFileAgentForScope` · `GET|PUT|DELETE /agents/files[/:slug]`
   → `list_agent_files` `write_agent_file` `delete_agent_file` · UI: Build an agent
   (`WriteAgentDialog`), Edit, Delete, the curated Catalog dialog, "On disk" rows with a raw-file
   editor (`EditAgentFileDialog`) · `isSafeFileStem` hoisted to `@vynel/contracts/fs` (both leaves
   need it) · tests that only need an agent ROW use `createAgentRowForTest` from
   `@vynel/agents/test-support`, and every test that goes through the API isolates the home
   (`beginHomeDirOverride`) — the mirror-for-every-source change wrote seven test agents into
   the developer's real `~/.claude/agents` once before that guard existed.
5. ⬜ **Docs** — `.claude/docs` books refresh.

## Findings worth their own move (not done here)

- **Tests write the developer's real `~/.claude.json`.** The MCP-config tests for the workspace
  scope (`install-skill-on-disk`, `uninstall-skill-from-disk`, `update-mcp-servers-for-scope`)
  approve project servers in the USER config through `resolveHostHomeDir()` without `withHomeDir`,
  and parallel vitest workers can tear that write — on 2026-08-26 the file was left with three junk
  bytes after the document (repaired from a backup by truncating to the valid prefix). Wrap those
  tests in the home seam.
- **Frontmatter parsing has four homes** (providers' skill discovery, skills' SKILL.md and
  command parsers, agents' file parser) and their unquote rules already differ (agents JSON-parses
  a `"…"` value, skills/commands strip the outer quotes only). A `@vynel/contracts/fs/
  markdown-frontmatter` (`splitFrontmatterBlock` + one `unquoteYamlScalar`) with per-leaf key
  mapping is the next hoist — the `isSafeFileStem` precedent.
- Cross-scope agent shadowing: `write_agent_file` refuses a same-scope Vynel slug only; a
  user-scope Vynel agent is composed into every workspace, so a workspace hand file with that slug
  is accepted yet shadowed there. Product call.
- `write_agent_file` / `create_agent` are not in the ask tier while `write_rule` is — an agent
  file is live in every future session at its scope; raise with Kafi.
- Two `installHealth` states (`mcp-config-drift`, `failed-install`) are never written.
- Rules stay flat (no `.claude/rules/**` recursion); commands nest.
- `updateSkillSettings` renders only `verified-catalog` rows (the template-clobber guard) — a
  `user` skill's settings persist but never render, by design.
