// `buildInProcessMcpServer` — in-process MCP server factory. Wraps the
// auto-generated tool registry (`generatedMcpTools`) in the Claude Agent SDK's
// `createSdkMcpServer`, with per-session credentials baked into each tool
// handler via the `(scope, app)` factory call.
//
// The `@anthropic-ai/claude-agent-sdk` import here is a BUILDER export
// (`createSdkMcpServer` / `SdkMcpToolDefinition`) — it carries no runtime and is
// permitted in the MCP layer per the AI-seam invariant (the SDK *runtime* stays
// in `packages/providers`). `SessionMcpServer` in `@vynel/mcp-contract` is
// already `ReturnType<typeof createSdkMcpServer>`, so this is the established
// producer boundary that narrows the SDK-free `McpToolFactory` return.
//
// Consumed by the turn composer (`composeSessionMcpServers`) via the `vynel`
// feature descriptor — never called from a route handler directly.

import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { McpScope, HonoAppRequestFn } from './mcp-types.js'
import { generatedMcpTools, generatedRoutingMcpTools } from './generated/api-tools.js'

export function buildInProcessMcpServer(
  scope: McpScope,
  app: HonoAppRequestFn,
): ReturnType<typeof createSdkMcpServer> {
  if (generatedMcpTools.length === 0) {
    throw new Error(
      'buildInProcessMcpServer: generatedMcpTools is empty — run `pnpm api:generate` to populate the registry.',
    )
  }
  // Each factory takes (scope, app) and returns a typed Tool from the SDK. We
  // pass `app` (the Hono dispatcher) so every handler can call `app(url, init)`
  // for the in-process equivalent of "wrap the API via HTTP".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary; mcp-types.ts declares McpToolFactory return as `unknown` to keep the SDK out of the type module.
  const tools = generatedMcpTools.map((factory) => factory(scope, app) as SdkMcpToolDefinition<any>)
  return createSdkMcpServer({
    name: 'vynel',
    version: '1.0.0',
    tools,
  })
}

// `buildGlobalRootMcpServer` — the in-process MCP server for a GLOBAL-ROOT turn.
// The global root is a MANAGER: its ONLY tools are the routing tools
// (`generatedRoutingMcpTools`), so it can SEE workspaces and DELEGATE down — it
// never reads a workspace's memory/files directly ("roots are managers, not
// doers"). Same server KEY (`vynel`) as the workspace turn — each turn builds its
// own server with the turn-appropriate toolset; they never coexist.
//
// KLONE has no routing routes yet, so `generatedRoutingMcpTools` is empty. Unlike
// the workspace registry (empty = a real error → throw), an empty routing set is
// EXPECTED until the global-root routing surface lands, so we return `null` — the
// composer's `build() === null → skip` idiom then omits the routing server
// gracefully instead of crashing the turn.
export function buildGlobalRootMcpServer(
  scope: McpScope,
  app: HonoAppRequestFn,
): ReturnType<typeof createSdkMcpServer> | null {
  if (generatedRoutingMcpTools.length === 0) {
    return null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary (see buildInProcessMcpServer).
  const tools = generatedRoutingMcpTools.map((factory) => factory(scope, app) as SdkMcpToolDefinition<any>)
  return createSdkMcpServer({
    name: 'vynel',
    version: '1.0.0',
    tools,
  })
}
