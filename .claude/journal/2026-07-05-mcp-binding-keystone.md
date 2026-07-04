# ③ agent-turn MCP binding keystone (2026-07-05)

Finish-everything pass, task #12 — the direction-③ keystone STATE has long flagged. Lands the
in-process MCP composition that lets a headless agent turn call Vynel's route-derived tools. **Faithful
port** of 3 source files (KLONE already had the substrate: `generatedMcpTools` factories, `mcp-contract`,
`McpScope`/`HonoAppRequestFn`, the agent-SDK builder allowed in the MCP layer). NOT yet wired into a live
turn — that's task #13 (fire-now/ticks); this lands the composable binding + tests.

## What landed (3 files)
- `apps/mcp/src/build-in-process-server.ts` — `buildInProcessMcpServer(scope, app)` wraps the 16 generated
  tool factories in `createSdkMcpServer` (SDK BUILDER export — permitted in the MCP layer per the AI-seam
  invariant; single-site). `buildGlobalRootMcpServer` for the routing set (empty today → returns **null**
  so the composer's `build()===null → skip` idiom omits it gracefully; workspace-empty still throws = real error).
- `apps/mcp/src/vynel-mcp-feature-descriptor.ts` — `vynelWorkspaceDescriptor` + `vynelRoutingDescriptor`
  (`McpFeatureDescriptor`). **Tool lists ALIGNED to KLONE's real registry:** `VYNEL_CAPABILITY_GATED_TOOLS`
  gates the 7 knowledge tools under `knowledge`; `memory` omitted (valid CapabilityId, zero tools yet);
  skills/channels/schedules aren't capabilities → ungated. `mutatingToolNames: []` (KLONE's mutating vynel
  tools `add_to_knowledge`/`remove_knowledge_source` are `x-mcp mutatingApproved` = auto, no card — Chad's
  current stance; they move here when the approval card lands).
- `apps/local-api/src/sessions/compose-session-mcp-servers.ts` — the pure composer (type-only mcp-contract;
  lives at the api edge per the locked `api-side-turn-execution-with-mcp`). Returns `{mcpServers,
  allowedMcpToolPatterns, deniedMcpToolPatterns, mutatingToolNames, systemPromptAppend}` — maps onto the
  provider seam (`start-chat-session-input`: mutatingToolNames→alwaysRequireApprovalToolNames, etc.).

## Deps + gate
- Added `@vynel/mcp-contract` (type-only) to `apps/mcp` + `apps/local-api` package.json.
- typecheck clean; 8 new tests (real vynel server builds without throwing + composer branch coverage).
  Full gate **1517 passed**; reviewer CLEAN (no must-fix) — SDK single-site + builder-only, alignment
  complete, not-yet-wired confirmed. Applied the reviewer's graceful-null improvement.

## Note
Committed backend-only (staged explicitly); Chad's parallel UI work + `pnpm-lock` left untouched. The
`@vynel/mcp-contract` dep is declared in the committed package.json (self-consistent; the lock is derivable).
Next (#13): wire `composeSessionMcpServers([vynelWorkspaceDescriptor])` into `FireScheduleDeps` + the
fire-now route + the fire tick — apps/local-api will add `@vynel/mcp` to import the descriptor.
