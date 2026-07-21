import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  actOnDesktop,
  DESKTOP_INPUT_ACTIONS,
  type ActOnDesktopParams,
} from '../input/desktop-input.js'

const TOOL_DESCRIPTION =
  "Control the desktop by COORDINATES — click, type, press keys, scroll, or drag at a pixel, the way a " +
  'person uses a mouse and keyboard. This CHANGES things on the screen. Use this when you only have a ' +
  "SCREENSHOT (no accessibility tree) — prefer act_on_app's selectors when snapshot_app exposes the " +
  'element. Pass `app` = the window name so x/y are relative to THAT window\'s screenshot (top-left = 0,0); ' +
  'omit `app` for absolute screen coordinates. Actions: click {x,y,button?,double?} · type {text} (into ' +
  'whatever is focused — click first) · press {keys} (e.g. "enter", "ctrl+c", "alt+f4") · scroll ' +
  '{x,y,direction?,amount?} · drag {x,y,toX,toY}. IMPORTANT: before an IRREVERSIBLE action (sending, ' +
  'deleting, paying, submitting), ask the user to confirm first. Windows only.'

function parseAction(raw: unknown): ActOnDesktopParams['action'] | null {
  return typeof raw === 'string' && (DESKTOP_INPUT_ACTIONS as readonly string[]).includes(raw)
    ? (raw as ActOnDesktopParams['action'])
    : null
}

// Read a typed field off the SDK's loose arg bag (undefined when absent/mistyped).
function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === 'number' ? (args[key] as number) : undefined
}
function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' ? (args[key] as string) : undefined
}

/** Construct the `act_on_desktop` SDK MCP tool (mutating — destructiveHint). */
export function makeActOnDesktopTool(): unknown {
  return (tool as unknown as McpToolFn)(
    'act_on_desktop',
    TOOL_DESCRIPTION,
    {
      action: z.enum(DESKTOP_INPUT_ACTIONS).describe('click · type · press · scroll · drag.'),
      app: z
        .string()
        .optional()
        .describe('Window name — makes x/y relative to that window\'s screenshot. Omit for absolute coords.'),
      x: z.number().optional().describe('X coordinate (click/scroll/drag start).'),
      y: z.number().optional().describe('Y coordinate (click/scroll/drag start).'),
      toX: z.number().optional().describe('Drag target X.'),
      toY: z.number().optional().describe('Drag target Y.'),
      text: z.string().optional().describe('Text to type (for the type action).'),
      keys: z.string().optional().describe('Key or combo to press, e.g. "enter" / "ctrl+c" (for press).'),
      button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button for click (default left).'),
      double: z.boolean().optional().describe('Double-click when true.'),
      direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Scroll direction (default down).'),
      amount: z.number().optional().describe('Scroll steps (default 3).'),
    },
    async (args: Record<string, unknown>) => {
      const action = parseAction(args['action'])
      if (action === null) {
        return {
          content: [
            { type: 'text', text: `Unknown action. Use one of: ${DESKTOP_INPUT_ACTIONS.join(', ')}.` },
          ],
          isError: true,
        }
      }
      // Read each field ONCE into a const so the `!== undefined` guard narrows
      // it (exactOptionalPropertyTypes rejects `number | undefined` on `x?: number`).
      const x = numberArg(args, 'x')
      const y = numberArg(args, 'y')
      const toX = numberArg(args, 'toX')
      const toY = numberArg(args, 'toY')
      const text = stringArg(args, 'text')
      const keys = stringArg(args, 'keys')
      const app = stringArg(args, 'app')
      const amount = numberArg(args, 'amount')
      const button =
        args['button'] === 'left' || args['button'] === 'right' || args['button'] === 'middle'
          ? (args['button'] as ActOnDesktopParams['button'])
          : undefined
      const direction =
        args['direction'] === 'up' ||
        args['direction'] === 'down' ||
        args['direction'] === 'left' ||
        args['direction'] === 'right'
          ? (args['direction'] as ActOnDesktopParams['direction'])
          : undefined
      const params: ActOnDesktopParams = {
        action,
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(toX !== undefined ? { toX } : {}),
        ...(toY !== undefined ? { toY } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(keys !== undefined ? { keys } : {}),
        ...(app !== undefined ? { app } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(button !== undefined ? { button } : {}),
        ...(typeof args['double'] === 'boolean' ? { double: args['double'] } : {}),
        ...(direction !== undefined ? { direction } : {}),
      }
      try {
        const result = await actOnDesktop(params)
        return { content: [{ type: 'text', text: `Done: ${result.detail}.` }] }
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
