import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Database } from '@vynel/db'
import type { McpToolFn } from './mcp-tool-fn.js'
import { findPlaybookById, type PlaybookShelfScope } from './playbook-shelf.js'

const TOOL_DESCRIPTION =
  'Open one book from the notebook by id (from list_playbooks). Returns the full markdown body — ' +
  'current, curated guidance for the task at hand. When a book matches the task, follow it and ' +
  'prefer its guidance over your own assumptions; it carries the latest verified practice. READ-ONLY.'

export function buildReadPlaybookResponse(
  db: Database,
  scope: PlaybookShelfScope,
  playbookId: string,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const playbook = findPlaybookById(db, scope, playbookId)
  if (playbook === null) {
    return {
      content: [
        {
          type: 'text',
          text: `No playbook with id "${playbookId}" is on this session's shelf. Call list_playbooks to see the available ids.`,
        },
      ],
      isError: true,
    }
  }
  return { content: [{ type: 'text', text: JSON.stringify(playbook, null, 2) }] }
}

/** Construct the read-only `read_playbook` SDK MCP tool. */
export function makeReadPlaybookTool(db: Database, scope: PlaybookShelfScope): unknown {
  return (tool as unknown as McpToolFn)(
    'read_playbook',
    TOOL_DESCRIPTION,
    { id: z.string().describe('The playbook id from list_playbooks (e.g. "web-app-scaffold").') },
    async (args) => {
      try {
        return buildReadPlaybookResponse(db, scope, String(args['id'] ?? ''))
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )
}
