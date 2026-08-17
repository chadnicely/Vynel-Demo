import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from '@vynel/mcp-contract'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'

// Written for the LLM, not the API user (sdk-mcp.md "Tool description quality
// bar"): name the action, the return shape, the scope, and the limits.
const TOOL_DESCRIPTION =
  'List desktop notification events the user received since an optional timestamp, oldest-first. ' +
  'Use this to answer "what did I miss?" / "any new notifications?" or to react to something that just ' +
  'arrived (a message, a calendar alert, an email). Each event has: app (source app display name), ' +
  'title, body, timestamp (ISO 8601). READ-ONLY — it observes notifications; it cannot dismiss them or ' +
  'act on them. One-time passcodes and 2FA codes are redacted to "[redacted code]" before you see them. ' +
  'Windows only today: returns an empty list on other platforms, or if the user has not granted ' +
  'notification access.'

/**
 * The tool's behavior, extracted pure for testing: read the buffer (already
 * redacted at ingest) and shape the agent-facing text payload.
 */
export function buildNotificationsResponse(
  reader: DesktopNotificationReader,
  since?: string,
): { content: Array<{ type: 'text'; text: string }> } {
  const notifications = reader.listSince(since)
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ count: notifications.length, notifications }, null, 2),
      },
    ],
  }
}

/** Construct the `list_desktop_notifications` SDK MCP tool over a reader. */
export function makeListDesktopNotificationsTool(reader: DesktopNotificationReader): unknown {
  return (tool as unknown as McpToolFn)(
    'list_desktop_notifications',
    TOOL_DESCRIPTION,
    {
      since: z
        .string()
        .optional()
        .describe(
          'ISO 8601 timestamp; return only notifications strictly after it. Omit to get all buffered notifications.',
        ),
    },
    async (args: Record<string, unknown>) => {
      const since = typeof args['since'] === 'string' ? args['since'] : undefined
      return buildNotificationsResponse(reader, since)
    },
    { annotations: { readOnlyHint: true } },
  )
}
