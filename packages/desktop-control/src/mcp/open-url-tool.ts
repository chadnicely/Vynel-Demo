import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { checkOpenableUrl, openUrl } from '../apps/open-url.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { unattendedRefusalError } from '../plan/plan-gated-authorization.js'
import { recordFailedAct } from '../plan/record-failed-act.js'

// Gated like the CLIPBOARD, not like launch_app, and the distinction matters:
// launch_app authorizes against the RESOLVED app the plan names, but which app
// answers a URL is the OS's default-handler decision — unknowable before the
// launch, so there is no app name to authorize. With no app there is no
// standing second door, which means `isArmed()` alone would be the whole gate —
// authority the model grants itself. `unattendedRefusalError` additionally
// requires real consent (a card or the user's own auto/bypass mode) and
// refuses under display-only, exactly the clipboard's reasoning.

const TOOL_DESCRIPTION =
  'Open a URL in its default app: https/http in the browser, mailto in the mail composer ' +
  '(composing only; the user sends), and the meeting links zoommtg (Zoom) and msteams (Teams) in ' +
  'their apps — how you join a meeting for the user. Requires an approved plan this turn — name the ' +
  'site or meeting in a plan step. File paths and other app schemes are refused: opening those can ' +
  'execute programs. Opening a page does not read it — use it to put something in front of the ' +
  'user, not to browse. Windows only.'

export type OpenUrlToolDeps = {
  open?: typeof openUrl
}

/** Construct the `open_url` SDK MCP tool (mutating — destructiveHint).
 *  Consent-gated by construction, exactly like the clipboard tools. */
export function makeOpenUrlTool(envelope: DesktopPlanEnvelope, deps: OpenUrlToolDeps = {}): unknown {
  const open = deps.open ?? openUrl
  return (tool as unknown as McpToolFn)(
    'open_url',
    TOOL_DESCRIPTION,
    {
      url: z
        .string()
        .min(1)
        .describe('The full absolute URL, scheme included — https://…, http://…, or mailto:…'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = unattendedRefusalError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const raw = typeof args['url'] === 'string' ? args['url'] : ''
      // Validate BEFORE recording: a refused scheme never launched anything,
      // so it is a refusal (no row), not a failed act.
      const checked = checkOpenableUrl(raw)
      if (!checked.ok) {
        return { content: [{ type: 'text', text: checked.reason }], isError: true }
      }
      try {
        const opened = await open(checked.url.href)
        envelope.recordAct({
          tool: 'open_url',
          appName: null,
          detail: `opened ${opened.href}`,
          // The default app got the request; whether a window actually showed
          // is not observed here — the model is told to look, like any act.
          outcome: 'unverified',
        })
        return {
          content: [
            {
              type: 'text',
              text:
                `Asked Windows to open ${opened.href} in its default app. That launches the app but ` +
                'does not confirm what appeared — use list_open_apps / screenshot_app if the next ' +
                'step depends on it.',
            },
          ],
        }
      } catch (err) {
        recordFailedAct(envelope, { tool: 'open_url', appName: null, detail: `open ${checked.url.href}` }, err)
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { destructiveHint: true } },
  )
}
