// Public surface for `@vynel/mcp`.
//
// This package hosts Vynel's MCP surfaces:
//   - the generated agent-bound tool registry (`./generated/api-tools.ts`,
//     emitted by `pnpm api:generate`) — direction ③, consumed in-process by
//     the providers layer when it lands (NOT re-exported; a private detail).
//   - the external stdio MCP server (`./external-mcp-server.ts` + the
//     `external-server.ts` bin) — direction ②: a generic server that reads
//     the committed OpenAPI spec and dispatches each tool call to the api
//     over HTTP.
//
// The in-process server builders + `McpFeatureDescriptor` wrappers that
// consume the generated registry (direction ③) land with their consumer —
// the apps/local-api turn composer + `packages/providers`.

export * from './mcp-types.js'
export {
  buildExternalMcpServer,
  collectExternalTools,
  type FetchDispatch,
  type OpenApiSpec,
  type ExternalTool,
  type ToolResult,
} from './external-mcp-server.js'
