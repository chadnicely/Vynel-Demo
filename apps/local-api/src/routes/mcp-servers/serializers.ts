// Serializers for the `mcp-servers` routes — the MASKING boundary. The
// package reader (`listMcpServersForScope`) returns header/env values
// verbatim for backend round-trips; nothing serialized here may carry a
// header VALUE or env VALUE. Names + presence only.

import type { ConfiguredMcpServer } from '@vynel/skills'
import type { SkillRequiredMcpServer } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { z } from 'zod'
import type { McpServerRowSchema, AddMcpServerRequestSchema } from './schemas.js'

export type McpServerRow = z.infer<typeof McpServerRowSchema>

export function serializeMcpServer(
  server: ConfiguredMcpServer,
  scope: 'user' | 'workspace',
): McpServerRow {
  if (server.transport === 'stdio') {
    return {
      serverName: server.serverName,
      scope,
      transport: 'stdio',
      commandOrUrl: server.command,
      args: server.args,
      environmentKeys: Object.keys(server.environment).sort(),
      headers: [],
    }
  }
  return {
    serverName: server.serverName,
    scope,
    transport: server.transport,
    commandOrUrl: server.url,
    args: [],
    environmentKeys: [],
    headers: Object.keys(server.headers)
      .sort()
      .map((name) => ({ name, hasValue: server.headers[name]!.length > 0 })),
  }
}

/** Request body → the writer's contract shape (one home for the mapping —
 *  both scope twins call it). */
export function toSkillRequiredMcpServer(
  body: z.infer<typeof AddMcpServerRequestSchema>,
): SkillRequiredMcpServer {
  if (body.transport === 'stdio') {
    return {
      serverName: body.serverName,
      transport: 'stdio',
      commandOrUrl: body.command,
      args: body.args,
      environment: body.environment,
    }
  }
  return {
    serverName: body.serverName,
    transport: body.transport,
    url: body.url,
    headers: body.headers,
  }
}
