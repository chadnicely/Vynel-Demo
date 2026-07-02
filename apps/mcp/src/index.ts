// Public surface for `@vynel/mcp`.
//
// Producer shell (Step B): this package exists to receive the generator
// output (`./generated/api-tools.ts`, emitted by `pnpm api:generate`)
// and prove the route → MCP-tool pipeline end-to-end + parity-guarded.
// The generated registry is intentionally NOT re-exported — it's a
// private implementation detail its consumers import directly.
//
// The server builders + feature descriptors that CONSUME the registry
// (`build-in-process-server.ts` → `createSdkMcpServer`, and the
// `McpFeatureDescriptor` wrappers) land in the move that pulls their
// consumers — the apps/api turn composer + `packages/providers`.

export * from './mcp-types.js'
