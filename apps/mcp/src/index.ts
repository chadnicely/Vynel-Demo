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
// The in-process server builders (direction ③) stay a private detail; the
// `McpFeatureDescriptor` wrappers that consume the generated registry are
// re-exported so the apps/local-api turn composer can DYNAMICALLY import them
// (`await import('@vynel/mcp')` → `vynelWorkspaceDescriptor`) — deferring the
// heavy SDK builder + generated registry until a turn actually needs it.

export * from './mcp-types.js'
export {
  buildExternalMcpServer,
  collectExternalTools,
  type FetchDispatch,
  type OpenApiSpec,
  type ExternalTool,
  type ToolResult,
} from './external-mcp-server.js'
export {
  vynelWorkspaceDescriptor,
  vynelWorkspaceInteractiveDescriptor,
  vynelRoutingDescriptor,
} from './vynel-mcp-feature-descriptor.js'
// The declared inventories + gate maps live on the `@vynel/mcp/tool-gates`
// subpath (vynel-tool-gates.ts) — not re-exported here so the catalog
// assembler skips this index's descriptor graph. KNOWN LIMIT: the subpath
// still transitively loads the generated registry, whose first import is the
// SDK's `tool` builder — so a static import of it puts the (builder-only)
// SDK on the api's boot path. The recorded fix is the Slice-6 generator
// improve: emit an SDK-free names/paths module and point the subpath there.
