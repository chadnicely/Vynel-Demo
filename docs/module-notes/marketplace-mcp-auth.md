# marketplace — MCP auth + provenance (module notes)

**The ask (Kafi, 2026-08-09):** grow the shipped `mcp` kind toward the Claude connector ecosystem —
one-click add for remote MCP servers including OAuth ("redirect auth") ones, with credentials
handled the way Claude Code handles them, so every install keeps working in Claude Code directly
(native-disk interop, the standing rule). Second lane (admin-hub marketplace aggregation) is
planned separately after this arc; v1 third-party marketplaces = Claude-native
`.claude-plugin/marketplace.json` format only (Kafi's call, 2026-08-09).

## Research findings (verified 2026-08-09)

- **The bundled `claude.exe` (2.1.213) ships `mcp login <name>` + `mcp logout <name>`** —
  "Authenticate with an MCP server (HTTP, SSE, or claude.ai connector)". `--no-browser` prints the
  authorization URL for headless flows. Tokens land in Claude Code's own OS-managed encrypted
  store; Vynel never reads, writes, or holds a credential. This is the delegate seam
  (`claude-plugin-cli.ts` precedent) extended to MCP auth.
- **The Agent SDK does NOT do OAuth itself** (`options.mcpServers` takes literal headers only) —
  but Vynel's sessions run through the SDK's bundled runtime, which owns the credential store.
  Whether an SDK session reuses `mcp login` tokens for config-declared servers is THE arc-closing
  smoke (browser step; the plugin native-pickup smoke of 2026-08-01 passed on the same logic).
- **Probe (2026-08-09, scratch `CLAUDE_CONFIG_DIR`): a `mcpServers` entry tolerates an extra
  `_vynelProvenance` field** — `mcp get`/`list` work, the field is not displayed, and it SURVIVES
  the CLI's own config rewrites (`mcp add` of another server preserved it). Marker-in-config is
  therefore viable — no DB ledger needed, config stays the single truth.
- **No `--json` on `mcp list`/`mcp get`** — status lines are human text, not a contract. v1 uses
  the `login` exit code as the success signal; parsing "Status:" lines is deferred.
- The 100+ connector directory (claude.ai/directory) has no public API; the official MCP registry
  (registry.modelcontextprotocol.io, `/v0.1/servers`) is machine-readable and lists remote server
  URLs — that ingestion belongs to the admin-hub lane, not this arc.

## The gap this arc closes

`McpItemManifest` today carries only STATIC `headers`/`environment` published on the hub row —
identical for every installer, plaintext in the catalog. A remote server needing per-user auth is
unpublishable honestly. And `mcp` is the one kind with no provenance guard: annotation matches on
bare `serverName`, so a hand-added server with a catalog item's name shows "Installed" and
marketplace uninstall DELETES the user's hand-made entry (the collision class agents closed via
`source === 'community'`, rules via the file marker, plugins via full-key matching).

## Design (settled, Kafi 2026-08-09: fix the provenance bug in this arc)

**Slice 1 — provenance marker (the bug fix; prerequisite so tokens never attach to hand-made
entries).** Marketplace installs stamp `_vynelProvenance: { itemId, installedAt }` into the entry
via the skills leaf's single writer; custom adds never stamp. The reader surfaces it; the
annotator matches `serverName` AND `provenance.itemId`; remove refuses an unmarked/other-marked
entry (rule-file-marker semantics, as config). Sweep for other bare-name matching while there.

**Slice 2 — manifest auth declaration + configure-at-install.** `McpItemManifestSchema` grows an
optional per-transport auth declaration (additive; published rows stay valid):
- stdio: `requiredEnvironment: [{ name, label, secret? }]` — user-supplied at install, merged
  into `environment`.
- remote: `auth: { type: 'oauth' }` (no static headers; connect after install) or
  `auth: { type: 'headers', required: [{ name, label }] }` (user-supplied at install).
Install route/request gains optional configuration values (validated: missing required fields =
actionable 400; values never logged — the list route already masks). UI: Get → configure dialog
(AddMcpServerDialog patterns) when the manifest declares required values. The session install
tool REFUSES config-requiring items with a pointer to the Marketplace UI — secrets don't transit
chat.

**Slice 3 — OAuth connect via the delegate.** `claude-mcp-cli.ts` beside the plugin CLI seam:
`loginMcpServer(serverName)` / `logoutMcpServer(serverName)` drive the bundled binary (browser
mode, timeout, exit-code = verdict). Install of an oauth item writes the config entry then
returns `authRequired: true`; the card shows Connect → route drives login → browser round-trip →
success flips the card. Uninstall runs best-effort `logout` before removing the entry.

**Slice 4 — seeds + the collision rule made structural.** Seed 2–3 real connectors (e.g. Notion,
Linear — http/oauth) with credits; hub publish-time validation rejects two published `mcp` items
declaring the same `serverName` (the curation rule that was prose becomes code — it must be
structural before the admin-hub lane multiplies sources).

**Arc-closing smoke (Kafi, browser):** install an oauth seed → Connect → authorize → a Vynel
session uses the server's tool → open Claude Code directly and confirm the same server works
there. That one pass proves token reuse AND native interop.

## Slice 1 as built (2026-08-09, worktree `feature/marketplace-mcp-auth`)

- `packages/skills/src/internal/mcp-server-provenance.ts` — the marker one-home
  (`_vynelProvenance: { itemId, installedAt }`, `readMcpServerProvenanceItemId`).
- `updateMcpServersForScope` reworked: additions are `{ server, provenance? }`, removals
  `{ serverName, onlyIfProvenanceItemId? }`; returns an outcome (removed / refusedRemovals /
  refusedAdditions). A provenance-carrying addition refuses a foreign entry; a marker-required
  removal refuses an unmarked/other-marked entry. Refusals REPORT — each caller decides:
  marketplace ops throw ConflictError, skill-uninstall skips silently (folder-rm posture),
  the user-driven mcp-servers routes pass no marker requirement at all.
- `listMcpServerEntriesForScope` (replaces the names-only lister) feeds the annotator
  `provenanceItemId`; the full-shape `ConfiguredMcpServer` view carries it too (UI badge later).
- Annotator: mcp match = serverName AND provenanceItemId === itemId (agents-slug precedent).
- Skill required-servers stamp the SKILL's id; shared-server ownership stays with the first
  installer (a refused re-add is tolerated — the skill runs against the existing entry).
- **Pre-marker installs (recorded trade-off):** existing unmarked entries honestly report
  not-installed; recovery is remove-then-re-Get (the ConflictError message points at the removal,
  since an unmarked entry refuses a provenance overwrite). Skill uninstalls orphan their unmarked
  required servers rather than risk deleting hand-made data. Protect > cleanup.
- Green: skills 171 · marketplace 64 · local-api marketplace routes 33 + mcp-servers routes 10;
  typecheck clean across skills/marketplace/local-api/mcp/cli/worker/providers. Full gate = Chad.

## Slice 2 as built (2026-08-09)

- **Contract:** `McpItemManifestSchema` grew additive auth declarations — stdio
  `requiredEnvironment: [{name,label,secret(=true)}]` (≤16), remote
  `auth: {type:'oauth'} | {type:'headers', requiredHeaders:[…]}` (≤8). Pure helpers:
  `toMcpItemAuthView` (card's pre-install knowledge) + `resolveMcpInstallConfiguration`
  (manifest + values → writer entry; result union, contracts stays dependency-free). Strictness:
  blank = missing (reported by LABEL, never value), undeclared names refused (no env/header
  injection through install values).
- **Wire:** `MarketplaceItem.mcpAuth?` stamped by the cloud-catalog mapper (UI never parses
  manifests); install bodies accept bounded `mcpConfigurationValues`; the mcp install response
  carries `authRequired` (oauth = entry written credential-less, connect follows in Slice 3).
  SDK + MCP tools regenerated, parity 4/4.
- **Session-tool posture:** value-less by design — a config-declaring item answers the actionable
  400 pointing at the Marketplace UI (secrets never transit chat); no special-casing needed.
- **UI:** `ConfigureMcpItemDialog.vue` (pure collector — the section owns the mutation, so
  pending/error stays card-scoped; secret fields render as password inputs); MarketplaceSection
  detours Get → dialog for 'fields' items; oauth items install one-click and await Slice 3's
  Connect affordance.
- Green: contracts+marketplace 84 · marketplace routes 35 · apps/mcp 21 · local-web 555 (26 in
  the section suite incl. the two detour cases) · parity 4/4. Full gate = Chad.
- **Review round (clean; 2 should-fixes + 2 minors, ALL applied):** ① the session tool's
  value-less posture made STRUCTURAL — new `x-mcp.excludedBodyFields` generator support drops
  `mcpConfigurationValues` from the emitted tool schema entirely (a model-invented value is
  stripped by the tool's zod object; the tool description directs config-requiring installs to
  the Marketplace panel) ② values record capped at 32 keys + unknown-name echo truncated to 8
  ③ dialog clears typed secrets on close, not just next open ④ secret inputs use
  `autocomplete="new-password"`.

## Deferred (named, not silent)

- Live connection status on the card (needs JSON output or tolerant text parsing of `mcp get`).
- `claude_desktop_config.json` bridge (unchanged from the mcp-kind arc — waits on Claude Desktop
  use).
- Registry-scale ingestion + review queue → admin-hub lane (`marketplace_sources` foundation,
  composite cache key, origin-derived verified badge, per-source sync).
- Found while probing: `claude-plugin-cli.ts` reads `~/.claude/plugins/` via `os.homedir()` while
  the CLI itself honors `CLAUDE_CONFIG_DIR` — harmless today (Vynel never sets it), worth one
  shared config-root resolver if that ever changes.
