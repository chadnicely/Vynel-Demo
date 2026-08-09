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

## Slice 3 as built (2026-08-09)

- **Provider seam** `providers/src/claude/installation/claude-mcp-cli.ts` —
  `loginClaudeMcpServer` / `logoutClaudeMcpServer` drive the bundled binary (`claude mcp
  login/logout <name>`); 5-min login ceiling (browser consent time), timeout surfaces as an
  actionable "finish the sign-in in your browser" error. `workingDirectory` matters: the CLI
  resolves `.mcp.json` servers from CWD, so workspace logins run inside the workspace.
- **App seam** `services/mcp-auth-delegate.ts` (plugin-delegate recipe) —
  `CreateAppOptions.mcpAuthDelegate` injectable; tests never open a browser.
- **Routes** `POST /mcp-servers/:serverName/login` (user) + workspace twin — 404 absent, 400
  stdio ("nothing to sign in to"), delegate failure = typed 400. Deliberately NOT x-mcp-exposed
  (a chat turn must not pop a browser); SDK `mcpServers.login`/`mcpServersUser.login` (245→247).
- **Oauth uninstall** clears the native credential best-effort BEFORE removing the entry
  (manifest-gated so non-oauth uninstalls never touch the CLI; a failed logout warns and never
  blocks).
- **UI**: card Connect pill (installed oauth items only; idempotent — reconnect refreshes),
  transient "Connected" readback (no persisted connection state exists to query), route split
  follows installStatus.scope (a user-scope install signs in via the global route even from a
  workspace shelf), connect errors join the card error slot.
- Green: mcp-servers routes 14 (4 login) · marketplace routes 37 (2 oauth-uninstall) ·
  section suite 29 (3 connect) · parity 4/4 · typechecks providers/local-api/local-web.
- **Review round (clean; 4 should-fixes ALL applied):** ① cleanup-warn logs `err` (house idiom)
  ② stderr-tail formatter extracted to `format-cli-error-detail.ts` (one home, own tests; the
  plugin CLI rewired) ③ `claude-mcp-cli.test.ts` exercises the real exec path via
  `process.execPath` as the fake binary (failure mapping + wording) ④ route-inventory headers
  name the login verb. Plus the deferred-improve leading-dash argv guard, taken now at the
  provider boundary (the DELETE param stays permissive — a hand-edited dash-name entry must
  remain removable). Still deferred: MarketplaceSection extraction (~314 lines, next touch).
- **⏳ Arc-closing smoke (Kafi, browser; needs a Slice-4 oauth seed published):** install →
  Connect → authorize → session uses the tool → same server works in Claude Code directly.

## Slice 4 as built (2026-08-09)

- **The serverName rule is now a publish wall** — `registry/assert-mcp-server-name-unique.ts`,
  called inside `publishCatalogArtifact` (every publish path funnels through it: upload,
  from-repo, import). Any-status comparison (a draft holds its name); same-item version bumps
  pass; the refusal names the holding item. Deliberate narrow bend of manifest-opacity — one
  string read, lenient on unreadable manifests. Prerequisite for the admin-hub multi-source arc.
- **Seeds:** `scripts/seed-catalog/{notion-mcp,sentry-mcp}/` — real hosted oauth connectors
  (Notion `https://mcp.notion.com/mcp`, Sentry `https://mcp.sentry.dev/mcp`), `auth: oauth`,
  `recommendedScope: user` (account-level, and keeps the first smoke off the `.mcp.json`
  project-approval wall), publisher credits + sourceUrl. ⚠ Chad/Kafi publish them from the
  portal (or `cloud:publish`) — nothing shows on the shelf until then.
- Green: registry 86 (17 in the publish-path files, 3 new wall cases) + cloud-api suites.

## Deferred (named, not silent)

- Live connection status on the card (needs JSON output or tolerant text parsing of `mcp get`).
- `claude_desktop_config.json` bridge (unchanged from the mcp-kind arc — waits on Claude Desktop
  use).
- Registry-scale ingestion + review queue → admin-hub lane (`marketplace_sources` foundation,
  composite cache key, origin-derived verified badge, per-source sync).
- Found while probing: `claude-plugin-cli.ts` reads `~/.claude/plugins/` via `os.homedir()` while
  the CLI itself honors `CLAUDE_CONFIG_DIR` — harmless today (Vynel never sets it), worth one
  shared config-root resolver if that ever changes.

## Handoff to the admin-hub lane (recorded 2026-08-09)

- Reviewer note to take into that arc: `publishItemVersion` is still barrel-exported — a direct
  caller would bypass the serverName wall; make the invariant structural (move the assert into
  `publishItemVersion`, or un-export) when publishing grows multi-source.
- Foundation blockers list for the source dimension lives in the research report (this doc's
  ancestor conversation) + `.claude/plan/marketplace-remaining.md` inherits nothing from it —
  the admin-hub lane starts with its own module notes.

## Live smoke finding #1 (Kafi, 2026-08-09) — login needs a console; FIXED

Connect failed from the daemon: the CLI aborts when `stdin.isTTY` is false — in BOTH modes,
even after arming its loopback callback ("stdin isn't a terminal … re-run in an interactive
terminal"). No pipe-based spawn can ever pass that check. Probed: a
`Start-Process -WindowStyle Hidden` child gets a REAL (invisible) console with
`stdin.isTTY: true`. Fix: Windows login runs through that PowerShell wrapper (bounded
`Wait-Process`, kill + exit 124 on timeout, child exit code passed through); errors become
exit-code based (the hidden console's stderr is unreachable — by design). Logout stays on the
plain pipe spawn (non-interactive; stderr detail intact). Non-Windows keeps the piped spawn +
the CLI's own actionable error until a pty seam is warranted.

## Live smoke finding #2 (Kafi, 2026-08-09) — the TWO consent walls; FIXED

Workspace Connect stayed dead after the console fix. Probed one wall at a time with Kafi
narrating the interactive flow (folder trust dialog -> per-server chooser):

1. **Folder trust** — `~/.claude.json` `projects["<path>"].hasTrustDialogAccepted`, keyed by
   the FORWARD-SLASH path spelling (backslash keys are invisible to the CLI). Until true, the
   project's `.claude/` settings are ignored ENTIRELY (reading settings from an untrusted
   folder would be the attack the dialog guards).
2. **Server approval** — the workspace's `.claude/settings.local.json`
   `enabledMcpjsonServers`/`disabledMcpjsonServers`; a REJECTION outranks approval (Kafi's
   workspace had notion + playwright dead from a declined chooser months of sessions never
   surfaced).

The consent-backed writer now records BOTH: folder trust (a Vynel workspace = the user's
explicitly added folder, sessions already run there) + approval with rejection-clearing.
Uninstall revokes only the approval; trust is folder-level standing consent. The legacy
`~/.claude.json` projects mcpjson arrays are dead — first fix targeted them, second round
found `settings.local.json`, third found the trust gate + key spelling. Confirmed live in
BOTH workspaces (trusted + fresh-untrusted): the login prints the authorize URL.

## Post-merge batch review (2026-08-09) — clean; 3 should-fixes applied

① approval writer no-op honesty (an already-recorded verdict never rewrites the file — the
login heal runs on every Connect) ② the single-writer exclusivity comment names its consent
sibling ③ the registry import refuses version-less plugins ('' fails the SEMVER wall →
invalid-metadata) instead of fabricating 0.0.0; inspection's metadata.version stays as an
ADMIN-VISIBLE prefill. Deferred (named): outer-timeout orphan + PS ExitCode-null hardening in
the hidden-console wrapper; typed-error sweep for the "user must repair a file" class;
non-atomic approval-after-config write; serverName-vs-rowKey matching asymmetry in
McpServersSection.

## Live smoke finding #3 (Kafi, 2026-08-10) — provider metadata outage reads as our timeout

Morning smoke: seo Connect "stuck" at Connecting… — root cause was NOTION-side:
`mcp.notion.com/.well-known/oauth-authorization-server` hung (000, every protocol/UA variant)
while its sibling well-known + /mcp answered in ms. The CLI's FIRST post-"Starting
authentication" step is that fetch, and it has no timeout of its own — our 5-min ceiling ends
it with "timed out — finish the sign-in in your browser", which MISLEADS for this failure (no
browser ever opened; none could). Known cosmetic gap of the hidden-console design (child
output unreachable → exit-code-only errors). Verified the chain healthy same-day against
Sentry (metadata 200 in 0.7s). If ever worth closing: pre-flight the metadata endpoint from
the DAEMON (a 5s fetch) before launching the login, so the card can say "the provider's
sign-in service isn't responding" instead.
