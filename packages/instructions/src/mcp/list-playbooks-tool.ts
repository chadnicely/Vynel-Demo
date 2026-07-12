import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listPlaybooks, type PlaybookShelfScope } from './playbook-shelf.js'

const TOOL_DESCRIPTION =
  'List the notebook — the shelf of playbooks available for this session. Each entry is a BOOK of ' +
  'current, curated guidance: verified books are maintained by the Vynel team with up-to-date best ' +
  'practice; the rest are documents this user wrote for you. Returns id, title, a one-liner, and a ' +
  'verified flag. READ-ONLY. Call this before starting a multi-step project or task, then ' +
  'read_playbook the id whose one-liner matches.'

export function buildListPlaybooksResponse(db: Database, scope: PlaybookShelfScope): {
  content: Array<{ type: 'text'; text: string }>
} {
  const playbooks = listPlaybooks(db, scope)
  return {
    content: [
      { type: 'text', text: JSON.stringify({ count: playbooks.length, playbooks }, null, 2) },
    ],
  }
}

/** Construct the read-only `list_playbooks` SDK MCP tool. */
export function makeListPlaybooksTool(db: Database, scope: PlaybookShelfScope): unknown {
  return (tool as unknown as McpToolFn)(
    'list_playbooks',
    TOOL_DESCRIPTION,
    {},
    async () => {
      try {
        return buildListPlaybooksResponse(db, scope)
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
