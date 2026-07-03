// Public surface for `@vynel/mcp-contract` — the MCP feature-attachment
// contract shared by every MCP-tool producer + the apps/local-api composer.
// Pure types, no runtime. See `./mcp-feature-descriptor.ts`.

export type {
  McpFeatureDescriptor,
  SessionToolContext,
  SessionMcpServer,
  HonoAppRequestFn,
} from './mcp-feature-descriptor.js'
