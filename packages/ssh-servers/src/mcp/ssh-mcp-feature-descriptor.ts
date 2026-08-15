// The `vynel-ssh` MCP feature descriptor — Claude's door to the user's
// servers, expressed as the shared `McpFeatureDescriptor`. A FACTORY (the
// asks precedent): the tools need the master key, which the composer's
// SessionToolContext doesn't carry — the api edge builds the descriptor with
// it. Attached to the INTERACTIVE app streams only (unattended scheduled SSH
// is a later, deliberate decision — module notes).
//
// NO CARDS on run_ssh_command (Chad's explicit call, module notes fork #2) —
// mutatingToolNames stays empty; the mitigations are the REQUIRED plain-
// language `description` (readable history), the verified server-work book,
// and TOFU host-key pinning. Claude NEVER sees a credential: the sealed blob
// opens only inside the exec path.

import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Database } from '@vynel/db'
import type { McpFeatureDescriptor } from '@vynel/mcp-contract'
import { listSshServers } from '../queries/list-ssh-servers.js'
import { runServerCommand } from '../connecting/run-server-command.js'
import type { StructuralLogger } from '../ssh-types.js'
import type { McpToolFn } from './mcp-tool-fn.js'

export const SSH_PROMPT_INSTRUCTIONS =
  'The user may have remote servers registered (list_ssh_servers). Before any server work, ' +
  'read the "working-with-servers" playbook in your notebook. Check state before changing it, ' +
  'prefer reversible steps, and verify after every change.'

const LIST_DESCRIPTION =
  "List the user's registered servers: name, host, username, scope, and when Vynel last " +
  'connected. Credentials are never included — run_ssh_command connects for you. Read-only.'

const RUN_DESCRIPTION =
  'Run one command on a registered server over SSH. `description` is REQUIRED plain language ' +
  'the user recognizes ("restart the website", "check disk space") — it becomes their visible ' +
  'history of what happened on their server. Returns exit code + stdout/stderr (capped). The ' +
  'command times out after 60s — long jobs need nohup/screen patterns (see the ' +
  'working-with-servers playbook). You never see credentials; Vynel connects. Check state ' +
  'before you change it, prefer reversible steps, verify after.'

export function buildSshFeatureDescriptor(deps: {
  masterKeyBase64: string
  logger?: StructuralLogger
}): McpFeatureDescriptor {
  return {
    serverName: 'vynel-ssh',
    toolNames: ['mcp__vynel-ssh__list_ssh_servers', 'mcp__vynel-ssh__run_ssh_command'],
    build: (context) => {
      // The one documented producer-boundary cast (the asks precedent).
      const db = context.db as Database
      const userId = context.userId
      const listTool = (tool as unknown as McpToolFn)(
        'list_ssh_servers',
        LIST_DESCRIPTION,
        {},
        async () => {
          try {
            const servers = listSshServers(db, { userId }).map((server) => ({
              id: server.id,
              name: server.name,
              host: server.host,
              port: server.port,
              username: server.username,
              scope: server.workspaceId === null ? 'global' : 'workspace',
              lastConnectedAt: server.lastConnectedAt?.toISOString() ?? null,
            }))
            return {
              content: [{ type: 'text', text: JSON.stringify({ count: servers.length, servers }) }],
            }
          } catch (err) {
            return {
              content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            }
          }
        },
        { annotations: { readOnlyHint: true } },
      )
      const runTool = (tool as unknown as McpToolFn)(
        'run_ssh_command',
        RUN_DESCRIPTION,
        {
          serverId: z.string().min(1),
          command: z.string().min(1).max(2000),
          description: z.string().min(3).max(200),
        },
        async (args) => {
          try {
            const result = await runServerCommand(
              db,
              {
                serverId: args.serverId as string,
                userId,
                command: args.command as string,
                description: args.description as string,
              },
              {
                masterKeyBase64: deps.masterKeyBase64,
                ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
              },
            )
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          } catch (err) {
            return {
              content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            }
          }
        },
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary (the notebook/asks precedent).
      const tools = [listTool, runTool].map((t) => t as SdkMcpToolDefinition<any>)
      return createSdkMcpServer({ name: 'vynel-ssh', version: '1.0.0', tools })
    },
    mutatingToolNames: [], // NO cards — Chad's call; see file header.
    // SSH is a pro feature (Chad 2026-07-17). These handlers call package ops
    // directly — no HTTP re-entry, so the `featureGate` middleware never sees
    // them; composition-level filtering is the ONLY tier gate on this server.
    featureGatedTools: {
      ssh: ['mcp__vynel-ssh__list_ssh_servers', 'mcp__vynel-ssh__run_ssh_command'],
    },
    contributePrompt: () => SSH_PROMPT_INSTRUCTIONS,
  }
}
