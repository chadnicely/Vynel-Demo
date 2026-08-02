// `McpServerConfig` + scope/transport unions + `ListMcpServersInput` — a
// read-only view of an MCP server configured for a provider. Installing MCP
// servers is the `marketplace` domain's job; this domain only reads config.
// See `docs/blueprints/providers/blueprint.md §7.1`.

import type { AiAgentProviderId } from './ai-agent-provider-id.js'

export type McpServerScope = 'user' | 'workspace' | 'project'

export type McpServerTransport = 'stdio' | 'http' | 'sse'

export type ListMcpServersInput = {
  workspacePath?: string
}

export type McpServerConfig = {
  providerId: AiAgentProviderId
  scope: McpServerScope
  serverName: string
  transport: McpServerTransport
  /** For stdio: the command. For http/sse: the URL. */
  commandOrUrl: string
  /** For stdio: the args. For http/sse: empty. */
  args: string[]
  /** For stdio: env vars. For http/sse: empty. Values are secrets — never log. */
  environment: Record<string, string>
  /** For http/sse: static auth headers. For stdio: empty. Values are secrets —
   *  they must be masked before leaving the backend (names + presence only). */
  headers: Record<string, string>
  isEnabled: boolean
}
