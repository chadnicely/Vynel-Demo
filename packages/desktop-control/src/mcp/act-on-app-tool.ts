import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { actOnApp, DESKTOP_ACTIONS, type ActOnAppResult, type DesktopAction } from '../a11y/xa11y-adapter.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'

const TOOL_DESCRIPTION =
  "Act on an element in a desktop app — click, type, or set a value. This CHANGES things on the user's " +
  'screen. First call snapshot_app to see the element\'s role + name, then target it: `app` = the app name; ' +
  '`selector` = `role[name="X"]` (e.g. button[name="Save"]) or `[stable_id="…"]` for precision; `action` = ' +
  'press (click) / type_text / set_value; `value` = the text for type_text or set_value. If the selector ' +
  'matches more than one element, NO action runs — you get the matches with their stable_ids, so re-target ' +
  'ONE precisely. IMPORTANT: before an IRREVERSIBLE action (sending a message, deleting, paying, submitting ' +
  'a form), ask the user to confirm first — do not do it autonomously. Windows only.'

function parseAction(raw: unknown): DesktopAction | null {
  return typeof raw === 'string' && (DESKTOP_ACTIONS as readonly string[]).includes(raw)
    ? (raw as DesktopAction)
    : null
}

export function buildActResponse(
  app: string,
  result: ActOnAppResult,
): { content: Array<{ type: 'text'; text: string }> } {
  if (result.kind === 'ambiguous') {
    const lines = result.candidates
      .map(
        (candidate) =>
          `  [stable_id="${candidate.stableId ?? '?'}"] ${candidate.role}${candidate.name ? ` "${candidate.name}"` : ''}`,
      )
      .join('\n')
    return {
      content: [
        {
          type: 'text',
          text:
            `Selector "${result.selector}" matched ${result.matchCount} elements in "${app}" — no action taken. ` +
            `Re-target ONE with a precise [stable_id="…"] selector:\n${lines}`,
        },
      ],
    }
  }
  return { content: [{ type: 'text', text: `Done: ${result.action} on ${result.selector} in "${app}".` }] }
}

/** Construct the `act_on_app` SDK MCP tool (mutating — destructiveHint). */
export function makeActOnAppTool(authorize?: DesktopAccessAuthorizer): unknown {
  return (tool as unknown as McpToolFn)(
    'act_on_app',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .min(1)
        .describe('The app/window name to act in (or a distinctive substring; match list_open_apps).'),
      selector: z
        .string()
        .min(1)
        .describe('Element selector from snapshot_app: `role[name="…"]` or `[stable_id="…"]` for precision.'),
      action: z.enum(DESKTOP_ACTIONS).describe('press (click) · type_text · set_value.'),
      value: z.string().optional().describe('The text to enter, for type_text or set_value.'),
    },
    async (args: Record<string, unknown>) => {
      const action = parseAction(args['action'])
      if (action === null) {
        return {
          content: [{ type: 'text', text: `Unknown action. Use one of: ${DESKTOP_ACTIONS.join(', ')}.` }],
          isError: true,
        }
      }
      try {
        const app = typeof args['app'] === 'string' ? args['app'] : ''
        const selector = typeof args['selector'] === 'string' ? args['selector'] : ''
        const value = typeof args['value'] === 'string' ? args['value'] : undefined
        return buildActResponse(app, await actOnApp(app, selector, action, value, authorize))
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { destructiveHint: true } },
  )
}
