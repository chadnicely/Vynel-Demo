# Config-surfaces views (rules · commands · skills · mcp-servers) — module notes

Task 2 of the 2026-08-02 five-task session. Desktop menus for the five
Claude-config surfaces + custom-MCP add, and the load-bearing MCP config
writer fix underneath them.

## The bug fix (landed first)

`updateMcpServersForScope` wrote `{command, args, env, transport}` for EVERY
server — Claude Code keys on `type` (SDK `McpStdioServerConfig` /
`McpHttpServerConfig` / `McpSSEServerConfig`), so a remote entry was garbage
executed as a stdio command. Fixed as one move:

- **Contract** — `SkillRequiredMcpServer` is now a union discriminated on
  `transport`: stdio keeps `commandOrUrl/args/environment`; `http`/`sse` get
  `url` + optional `headers`. `McpItemManifestSchema` mirrors it and stays
  tolerant of published rows: the old stdio shape parses unchanged, an old
  remote manifest's `commandOrUrl` is lifted into `url`.
- **Writer** — emits `{type:'stdio', command, args, env}` vs
  `{type, url, headers}` (empty headers omitted). The bogus `transport` key
  is gone. Single-writer rule intact (`packages/skills` internal only).
- **Readers** — `list-claude-configured-mcp-servers.ts` (providers) and the
  new full-shape `listMcpServersForScope` (skills) discriminate on `type`;
  a legacy `{command, transport}` entry reads as stdio (that IS how Claude
  Code executes it) and never crashes a list. Providers' `McpServerConfig`
  gained `headers` for round-trip honesty.

## Shape

- **Packages** (`@vynel/skills`): `mcp-servers/list-mcp-servers-for-scope.ts`
  (full-shape sync read), `mcp-servers/add-custom-mcp-server-for-scope.ts`
  (collision → ConflictError; https-only remote with loopback exemption),
  `rules/list-all-rule-files-for-scope.ts` (UNFILTERED — the marker-filtered
  reader stays the marketplace annotator's), `commands/` (new concern folder:
  root resolver + `listCommandsForScope`, built for Task 3's "/" menu reuse).
  `listInstalledSkillsForContext` accepts `workspaceId: null` (user rows only).
- **Routes** (`apps/local-api`): twins per surface following the Task-4
  pattern — `/rules` + `/workspaces/:id/rules`, same for `/commands` and
  `/mcp-servers`, plus `/skills/installed` (user scope) for the global Skills
  view. Workspace GETs fuse user ∪ workspace with a scope tag per row
  (how Claude Code resolves configs in a project); MCP mutations touch only
  their own scope's file (a Global row removes via the user twin even from a
  workspace surface). **x-mcp OFF everywhere** — management surface for the
  human. No approval cards (user-initiated form actions).
- **UI** (`apps/local-web`): `SkillsSection` (extracted from the drawer's
  inline list — the panel is pure dispatch now), `RulesSection` (read-only +
  view dialog, "Managed by Vynel" chip on marker matches), `CommandsSection`,
  `McpServersSection` + `AddMcpServerDialog` (+ shared `KeyValueRowsField`).
  All registered in workspace-sections / AppShell / GlobalChatView /
  WorkspaceSectionPanel; palette picks them up via GLOBAL_SECTIONS.

## Security posture (settled)

- Header/env VALUES leave the client exactly once — the add POST — and land
  in the config file (Chad: headers-in-config, what Claude Code reads).
  Every read back is masked at the ROUTE serializer: names + `hasValue`
  only; the wire never carries a value, so the DOM can't either. Logs carry
  serverName/scope only. The dialog renders value fields as password inputs.
- Remote URLs: https only; plain http allowed for localhost/127.0.0.1/[::1].
  Enforced in the package op, mirrored client-side for early teaching.
- Custom add REFUSES an existing name (409) — the idempotent-overwrite
  writer is reserved for marketplace repair installs.

## Decisions of note

- Scope chips read "Global" / the workspace's name (the shipped section
  idiom) rather than the brief's literal "User/Workspace" wording.
- Workspace teaching note is a note, not a restriction: the `.mcp.json` may
  be committed with the project; the user manages their own gitignore.
- Rules list carries full file content (rule files are tiny) so the view
  dialog needs no second fetch.
- Command names: relative path minus `.md`, `/` → `:` (Claude Code's
  namespacing), recursion depth-capped at 4.

## Deferred

- OAuth for remote MCP servers (v1 = static headers; Chad).
- Rule editing/creating from the view (read-only v1); command editing too.
- Skills install/uninstall from the Skills section (stays in Marketplace).
- Editing an existing MCP server (remove + re-add covers v1).
- The engine/runtime does not hot-reload MCP config; entries apply on the
  next session (same as Claude Code CLI behavior).
