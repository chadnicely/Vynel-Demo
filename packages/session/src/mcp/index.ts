// The `@vynel/session/mcp` subpath — the session package's own MCP feature
// (the `vynel-session` server: `whoami`). Kept OFF the package barrel: the
// barrel is web-safe (mode model only) and this subpath carries the SDK
// builder primitives. Per `.claude/rules/structure-standard.md`.

export {
  buildSessionFeatureDescriptor,
  resolveWhoamiScope,
  SESSION_PROMPT_INSTRUCTIONS,
  WHOAMI_TOOL_NAME,
  type SessionFeatureDescriptorDeps,
} from './session-mcp-feature-descriptor.js'
export { buildSessionMcpServer, SESSION_MCP_SERVER_NAME } from './build-session-mcp-server.js'
export { buildWhoamiResponse, type WhoamiToolScope } from './whoami-tool.js'
