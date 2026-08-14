---
name: mcp-development
description: >
  Add, change, or gate a Vynel MCP tool the house way: expose an api route via x-mcp (path A)
  or ship a descriptor-owned SDK tool (path B), regenerate the lockstep artifacts, wire
  policy defaults (surfaces, card class, tier, capability), and pass every parity/census
  guard. Use whenever a task touches agent-callable tools, McpFeatureDescriptors, the tool
  catalog, or tool policy defaults.
---

Vynel's tools are generated and governed — never hand-wired per surface. One regeneration
step keeps the SDK, both MCP servers (in-process + external `vynel-mcp`), the contracts
catalog snapshot, and the admin matrices in lockstep; the tool-policy layer then decides
where each tool attaches, when it cards, and who gets it. Background reading (skim before a
non-trivial change): `.claude/docs/_platform/tool-policy/structure.md` ·
`.claude/docs/_apps/mcp/structure.md` · `docs/module-notes/tool-policy.md`.

## Choose the path

- **Path A — API-backed tool** (the default): the tool is an api route the agent calls
  in-process. Almost every tool is this: one route = one rulebook for UI and agent.
- **Path B — descriptor-owned tool**: the tool needs process state or the SDK tool builder
  directly (precedents: `ask_user`'s waiter registry, ssh's sealed keys, the notebook reads).
  Only when a plain route genuinely can't carry it.

## Path A — expose a route

1. **Annotate the route** with `describeRoute({ 'x-mcp': {...} })` in `apps/local-api/src/routes/`:
   `exposed: true, name, description` is the ticket; a **non-GET route MUST set
   `mutatingApproved: true`** or the generator refuses to emit (D7). Surface flags:
   `rootSurface` (routing array), `workspaceInteractiveSurface`, `workspaceSurface` (a routing
   tool also in the plain workspace array), `askApproval` (join the ask-mode card tier —
   DELETE routes join automatically), `excludedBodyFields` (secrets never transit chat),
   `ambientWorkspace: false` (omitted workspaceId ≠ "my workspace"). Full flag semantics:
   `scripts/src/generators/generate-mcp-tools.ts` header.
2. **Regenerate:** `cmd.exe /c "pnpm api:generate"` — emits the SDK, the tool registry
   (`apps/mcp/src/generated/api-tools.ts`), and the catalog snapshot
   (`packages/contracts/src/generated/tool-catalog-snapshot.ts`). Never hand-edit generated
   files; they're parity-guarded in the gate.
3. **Update the census:** `apps/mcp/src/generated/api-tools.test.ts` pins every tool name per
   array — add yours with a one-line WHY.
4. **Gate the tool (optional):** tier → add to `VYNEL_FEATURE_GATED_TOOLS` /
   `ROUTING_FEATURE_GATED_TOOLS`; capability → `VYNEL_CAPABILITY_GATED_TOOLS` (all in
   `apps/mcp/src/vynel-tool-gates.ts`). Gated at composition = invisible out-of-tier, not a
   403.

## Path B — descriptor-owned tool

1. **One `McpFeatureDescriptor`** (`packages/mcp-contract`): `serverName`, `build(context)`
   (may return null to self-exclude), **`toolNames` declared** (full `mcp__<server>__<name>`
   strings — pin-test the inventory in the owning package), `mutatingToolNames` (auto-card in
   EVERY mode), `askModeApprovalToolNames`, `capabilityGatedTools` / `featureGatedTools`,
   `contributePrompt`. SDK **builder** imports only (`tool`, `createSdkMcpServer`) — the
   runtime stays in `packages/providers`.
2. **Grant the surfaces in the catalog** — the step everyone forgets (it shipped a tool inert
   once): `apps/local-api/src/sessions/session-tool-catalog.ts` needs the server in
   `SURFACE_DESCRIPTOR_SETS` for each kind AND the entry's `surfaces` in `FIXED_SERVERS`.
   **Attaching a descriptor at a turn site without granting the surface here means the policy
   layer denies the very tool you composed.** Pin the surfaces in
   `session-tool-catalog.test.ts`; the real-catalog compose test in
   `compose-session-mcp-servers.test.ts` catches the mismatch class.
3. **Attach at the composition sites** for those kinds (the streams / background builders) —
   follow how `askFeatureDescriptor` / `sshFeatureDescriptors` ride `chat-turn.ts`.
4. **Regenerate anyway** (`pnpm api:generate`) — the catalog snapshot must gain your entries.

## Policy is automatic — but know the defaults

A new tool ships: enabled · card class `never` (unless DELETE / `askApproval` → `ask`) · the
surfaces its arrays/entry declare · whatever gates you mapped. Everything is retunable
without code: per-user in the app's Tool access panel, globally in cloud-admin-web's Tool
policy page (baked into releases at build time). Resolution order: code catalog → baked
operator map → user override; user wins.

## The traps (each has bitten)

- **`vi.mock('@vynel/capabilities')` and friends**: local-api tests stub package barrels —
  a new export breaks the stubs at TEST-RUNTIME, not typecheck. Grep `vi.mock('` for the
  package you widened.
- **Same toolset for every background producer** — new background turn producers go through
  `buildWorkspaceBackgroundMcpComposer` / `buildDelegatedTurnMcpComposer`, never inline, or
  the SDK's session resume strips the server ("MCP server disconnected").
- **Generated files live under `src/generated/`** so the format/eslint ignores cover them —
  emit new generated artifacts there, nowhere else.
- **Sort with codepoint comparisons** in generators — `localeCompare` flaps parity across
  machines.
- **Bare names in `allowedTools` shadow the permission callback** — native names only; MCP
  names never ride `allowedTools`.

## Verify before shipping

```
cmd.exe /c "pnpm api:generate"        # artifacts current
cmd.exe /c "pnpm test"                # typecheck + ALL parity guards + vitest (repo root, real exit code)
```
Then the live check: boot `pnpm dev api` — no `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning, the
tool appears in the Tool access panel, and a turn on the intended surface can call it.
