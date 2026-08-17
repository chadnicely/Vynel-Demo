// Public surface for `@vynel/mcp-contract` — the MCP feature-attachment
// contract shared by every MCP-tool producer + the apps/local-api composer.
// Pure types, no runtime. See `./mcp-feature-descriptor.ts`.

export type {
  McpFeatureDescriptor,
  SessionToolContext,
  SessionMcpServer,
  HonoAppRequestFn,
  DesktopPlanConsent,
} from './mcp-feature-descriptor.js'
// The SDK `tool()` widening every producer casts through — one home, no twins.
export type { McpToolFn, McpToolContent } from './mcp-tool-fn.js'
