// `system_status` — the machine's vital signs.
//
// READ-ONLY, so it needs no plan and raises no overlay, exactly like the other
// looking tools. It reports on the MACHINE, not on any one app, so there is no
// target to resolve and nothing to confine.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpToolFn } from './mcp-tool-fn.js'
import { formatSystemStatus, readSystemStatus, type SystemSnapshot } from '../system/system-status.js'

const TOOL_DESCRIPTION =
  "How the computer itself is doing: CPU load, memory, battery, free disk space, and which " +
  'programs are busiest right now. READ-ONLY, no plan needed. Use it for "why is my computer so ' +
  'slow", "how much battery have I got", "am I running out of space", or before starting ' +
  'something heavy. One call returns all of it — the answer to a slow machine is usually the CPU ' +
  'figure AND the busiest program together, so do not go looking for these one at a time.'

export type SystemStatusToolDeps = { read?: () => Promise<SystemSnapshot> }

/** Construct the read-only `system_status` SDK MCP tool. */
export function makeSystemStatusTool(deps: SystemStatusToolDeps = {}): unknown {
  const read = deps.read ?? readSystemStatus
  return (tool as unknown as McpToolFn)(
    'system_status',
    TOOL_DESCRIPTION,
    {},
    async () => {
      try {
        return { content: [{ type: 'text', text: formatSystemStatus(await read()) }] }
      } catch (err) {
        // Degrade to an honest failure rather than a partial fiction: a machine
        // that cannot report its own vitals must not have them guessed at.
        return {
          content: [
            {
              type: 'text',
              text:
                'Could not read the machine status: ' +
                (err instanceof Error ? err.message : String(err)),
            },
          ],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )
}
