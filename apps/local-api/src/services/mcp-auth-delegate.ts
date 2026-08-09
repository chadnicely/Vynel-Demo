// The MCP-server auth delegate — the app-layer seam between the mcp-servers
// login route (and the marketplace's oauth-uninstall cleanup) and the
// provider's `claude mcp login/logout` CLI. Same recipe as the plugin
// delegate: lives in services/ so factory.ts and the routes both import it
// without a cycle; tests inject a fake via `CreateAppOptions.mcpAuthDelegate`
// so the HTTP stack never opens a real browser.

import { loginClaudeMcpServer, logoutClaudeMcpServer } from '@vynel/providers'

export type McpAuthDelegate = {
  login(input: { serverName: string; workingDirectory?: string; serverUrl?: string }): Promise<void>
  logout(input: { serverName: string; workingDirectory?: string }): Promise<void>
}

export const claudeMcpAuthDelegate: McpAuthDelegate = {
  login: (input) => loginClaudeMcpServer(input),
  logout: (input) => logoutClaudeMcpServer(input),
}
