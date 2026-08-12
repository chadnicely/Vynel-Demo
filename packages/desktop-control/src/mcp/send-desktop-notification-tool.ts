import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  sendDesktopToast,
  TOAST_TITLE_MAX_LENGTH,
  TOAST_MESSAGE_MAX_LENGTH,
} from '../notifications/send-toast.js'

// UNGATED on purpose, and the reasoning matters: the tool's headline use is a
// BACKGROUND task saying "I'm done" — and a background turn runs under
// 'display-only' consent, where the plan envelope refuses every act. Gating
// this like an act would disable it for exactly the turn it exists to serve.
// It is also the rare "act" the user cannot miss: a toast IS its own overlay,
// dismissable, reads nothing, changes no app. The accountability the action
// record provides for invisible acts is provided here by the toast itself.

const TOOL_DESCRIPTION =
  "Show a Windows toast notification (bottom-right, lands in the notification center). Use it to tell the user something when they may not be looking at the chat — a background task finishing, something needing their attention. A notification is a headline, not a report: short title, one-line message, detail stays in chat. Titles are shown prefixed \"Vynel — \", and the toast attributes itself to \"Windows PowerShell\" — both expected. Windows only."

export type SendDesktopNotificationToolDeps = {
  send?: typeof sendDesktopToast
}

/** Construct the `send_desktop_notification` SDK MCP tool (read-tier surface —
 *  see the file header for why it is not plan-gated). */
export function makeSendDesktopNotificationTool(
  deps: SendDesktopNotificationToolDeps = {},
): unknown {
  const send = deps.send ?? sendDesktopToast
  return (tool as unknown as McpToolFn)(
    'send_desktop_notification',
    TOOL_DESCRIPTION,
    {
      title: z
        .string()
        .min(1)
        .max(TOAST_TITLE_MAX_LENGTH)
        .describe('The headline — what happened, in a few words.'),
      message: z
        .string()
        .max(TOAST_MESSAGE_MAX_LENGTH)
        .optional()
        .describe('One supporting line. Omit when the title says it all.'),
    },
    async (args: Record<string, unknown>) => {
      const title = typeof args['title'] === 'string' ? args['title'] : ''
      const message = typeof args['message'] === 'string' ? args['message'] : undefined
      try {
        await send({ title, ...(message !== undefined ? { message } : {}) })
        return {
          content: [
            {
              type: 'text',
              text: 'Notification shown. It also landed in the Windows notification center.',
            },
          ],
        }
      } catch (err) {
        // The real platform error, verbatim — a dead WpnUserService says
        // "Class not registered (0x80040154)" here, and pretending the toast
        // was sent would be the tool's-silence-becomes-a-platform-claim
        // mistake this package already made once with launch_app.
        return {
          content: [
            {
              type: 'text',
              text:
                `The notification could NOT be shown: ${err instanceof Error ? err.message : String(err)} ` +
                'Tell the user in chat instead.',
            },
          ],
          isError: true,
        }
      }
    },
  )
}
