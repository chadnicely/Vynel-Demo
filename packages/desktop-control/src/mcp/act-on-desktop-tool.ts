import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  actOnDesktop,
  planDesktopAction,
  DESKTOP_INPUT_ACTIONS,
  type ActOnDesktopParams,
} from '../input/desktop-input.js'
import { waitForForegroundSettle } from '../input/foreground-settle.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makePlanGatedAuthorizer, planRequiredError } from '../plan/plan-gated-authorization.js'
import { buildBatchResponse, runActionBatch, MAX_BATCH_ACTIONS } from './act-batch.js'

const TOOL_DESCRIPTION =
  "Control the desktop by COORDINATES — click, type, press keys, scroll, or drag at a pixel, the way a " +
  'person uses a mouse and keyboard. This CHANGES things on the screen. Requires a plan: call ' +
  "propose_desktop_plan first (once per task). Use this when you only have a " +
  "SCREENSHOT (no accessibility tree) — prefer act_on_app's selectors when snapshot_app exposes the " +
  'element. Pass `app` = the window name so x/y are relative to THAT window\'s screenshot (top-left = 0,0); ' +
  'omit `app` for absolute screen coordinates. Actions: click {x,y,button?,double?} · type {text} (into ' +
  'whatever is focused — click first) · press {keys} (e.g. "enter", "ctrl+c", "alt+f4") · scroll ' +
  '{x,y,direction?,amount?} · drag {x,y,toX,toY,via?} (stepped, so a real drag-and-drop actually ' +
  'lands; `via` pauses on waypoints for targets that only open when hovered) · ' +
  'move {x,y} (hover, to open a hover menu or reveal a tooltip). ' +
  'BATCH RELATED STEPS: pass `actions` = [{action, …}, …] ' +
  'to run several in ONE call (e.g. click a field, type into it, press enter) — much faster than one call ' +
  'per step. They run in order and STOP at the first failure, which is reported with what did and did not ' +
  'run. Use the single form when you must see the result before choosing the next step. IMPORTANT: an ' +
  'IRREVERSIBLE action (sending, deleting, paying, submitting) must be stated in the approved plan — one ' +
  'that is not still needs the user\'s confirmation first. Windows only.'

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

/**
 * Build execution params from one loose arg bag — the single form's own args or
 * one batch step. The `app` (the coordinate frame) always comes from the CALL,
 * never from a step, so a batch can't wander into a window the call didn't
 * name. Returns null on an unknown action; per-action field validation stays
 * in `planDesktopAction` (native-free, fail-closed).
 */
export function parseActOnDesktopParams(
  bag: Record<string, unknown>,
  app: string | undefined,
): ActOnDesktopParams | null {
  const action = parseAction(bag['action'])
  if (action === null) return null
  // Read each field ONCE into a const so the `!== undefined` guard narrows
  // it (exactOptionalPropertyTypes rejects `number | undefined` on `x?: number`).
  const x = numberArg(bag, 'x')
  const y = numberArg(bag, 'y')
  const toX = numberArg(bag, 'toX')
  const toY = numberArg(bag, 'toY')
  const via = Array.isArray(bag['via']) ? (bag['via'] as unknown[]) : undefined
  const text = stringArg(bag, 'text')
  const keys = stringArg(bag, 'keys')
  const amount = numberArg(bag, 'amount')
  const button =
    bag['button'] === 'left' || bag['button'] === 'right' || bag['button'] === 'middle'
      ? (bag['button'] as ActOnDesktopParams['button'])
      : undefined
  const direction =
    bag['direction'] === 'up' ||
    bag['direction'] === 'down' ||
    bag['direction'] === 'left' ||
    bag['direction'] === 'right'
      ? (bag['direction'] as ActOnDesktopParams['direction'])
      : undefined
  return {
    action,
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(toX !== undefined ? { toX } : {}),
    ...(toY !== undefined ? { toY } : {}),
    ...(via !== undefined ? { via } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(keys !== undefined ? { keys } : {}),
    ...(app !== undefined ? { app } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(button !== undefined ? { button } : {}),
    ...(typeof bag['double'] === 'boolean' ? { double: bag['double'] } : {}),
    ...(direction !== undefined ? { direction } : {}),
  }
}

/**
 * Parse the loose `actions` arg into execution params — null when unusable.
 * Validates EVERY step up front (via the pure, native-free `planDesktopAction`)
 * so a malformed batch fails ATOMICALLY: with N separate calls a bad call
 * mutated nothing, and a half-executed batch — click landed, type rejected —
 * would leave the screen part-way through for no reason the model could see.
 */
export function parseActOnDesktopSteps(
  raw: unknown,
  app: string | undefined,
): ActOnDesktopParams[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH_ACTIONS) return null
  const steps: ActOnDesktopParams[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null
    const params = parseActOnDesktopParams(entry as Record<string, unknown>, app)
    if (params === null) return null
    try {
      planDesktopAction(params)
    } catch {
      return null
    }
    steps.push(params)
  }
  return steps
}

// Actions that can hand focus to another window — after one of these the next
// step's focus/hit-test probe must not read the pre-click world (see
// `input/foreground-settle.ts`). Scroll never activates a window.
//
// `press` is in the set because a KEYSTROKE can move the foreground too
// (`alt+tab`, `win`): the mouse path would still fail closed on its own
// coordinate-derived walls, but focus-directed input after such a keystroke
// would otherwise authorize against the pre-keystroke focused window — an
// assumption about OS timing rather than a guarantee.
const FOCUS_CHANGING_ACTIONS = new Set<ActOnDesktopParams['action']>(['click', 'drag', 'press'])

/** Construct the `act_on_desktop` SDK MCP tool (mutating — destructiveHint).
 *  The envelope is REQUIRED — acting is PLAN-GATED by construction: refused
 *  until the turn's plan is armed, and the armed plan authorizes its apps
 *  and it is the ONLY authority. (An optional envelope would be a fail-open
 *  default waiting for a second construction site.) */
export function makeActOnDesktopTool(
  envelope: DesktopPlanEnvelope,
): unknown {
  const effectiveAuthorize = makePlanGatedAuthorizer(envelope)
  return (tool as unknown as McpToolFn)(
    'act_on_desktop',
    TOOL_DESCRIPTION,
    {
      action: z
        .enum(DESKTOP_INPUT_ACTIONS)
        .optional()
        .describe('Single action: click · type · press · scroll · drag · move.'),
      // NOTE: `move` reuses x/y; no new parameter is needed.
      app: z
        .string()
        .optional()
        .describe('Window name — makes x/y relative to that window\'s screenshot. Omit for absolute coords.'),
      x: z.number().optional().describe('X coordinate (click/scroll/drag start).'),
      y: z.number().optional().describe('Y coordinate (click/scroll/drag start).'),
      toX: z.number().optional().describe('Drag target X.'),
      toY: z.number().optional().describe('Drag target Y.'),
      via: z
        .array(z.object({ x: z.number(), y: z.number() }))
        .optional()
        .describe(
          'Drag ONLY — points to travel through while the button is held, pausing at each. Use ' +
            'when the drop target only appears mid-drag: a folder that springs open when hovered, ' +
            'a tab you must cross to reach another window. Without these the pointer goes straight ' +
            'there and never gives those targets a chance to react.',
        ),
      text: z.string().optional().describe('Text to type (for the type action).'),
      keys: z.string().optional().describe('Key or combo to press, e.g. "enter" / "ctrl+c" (for press).'),
      button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button for click (default left).'),
      double: z.boolean().optional().describe('Double-click when true.'),
      direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Scroll direction (default down).'),
      amount: z.number().optional().describe('Scroll steps (default 3).'),
      actions: z
        .array(
          z.object({
            action: z.enum(DESKTOP_INPUT_ACTIONS).describe('click · type · press · scroll · drag · move.'),
            x: z.number().optional(),
            y: z.number().optional(),
            toX: z.number().optional(),
            toY: z.number().optional(),
            via: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
            text: z.string().optional(),
            keys: z.string().optional(),
            button: z.enum(['left', 'right', 'middle']).optional(),
            double: z.boolean().optional(),
            direction: z.enum(['up', 'down', 'left', 'right']).optional(),
            amount: z.number().optional(),
          }),
        )
        .min(1)
        .max(MAX_BATCH_ACTIONS)
        .optional()
        .describe('Batch: several actions run in order, stopping at the first failure. `app` applies to all.'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = planRequiredError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const app = stringArg(args, 'app')

      if (args['actions'] !== undefined) {
        if (args['action'] !== undefined) {
          return {
            content: [
              {
                type: 'text',
                text: 'Pass EITHER a single "action" OR "actions" for a batch — not both.',
              },
            ],
            isError: true,
          }
        }
        const steps = parseActOnDesktopSteps(args['actions'], app)
        if (steps === null) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `"actions" must be 1-${MAX_BATCH_ACTIONS} entries, each with a valid ` +
                  `"action" (${DESKTOP_INPUT_ACTIONS.join(' | ')}) plus that action's required ` +
                  'fields (click/scroll need x+y, type needs text, press needs keys, drag needs ' +
                  'x+y+toX+toY). Nothing ran.',
              },
            ],
            isError: true,
          }
        }
        // Each step re-resolves its target + re-authorizes inside actOnDesktop —
        // batching is a convenience over N calls, never a shortcut past the gate.
        return buildBatchResponse(
          await runActionBatch(
            steps,
            async (step) => {
              const result = await actOnDesktop(step, effectiveAuthorize)
              // Every step of a batch gets its own row: a batch that stopped
              // half-way is exactly the case "how far did it get" must answer.
              envelope.recordAct({
                tool: 'act_on_desktop',
                appName: step.app ?? null,
                detail: result.recordDetail,
                outcome: 'unverified',
              })
              return { ok: true, detail: result.detail }
            },
            {
              betweenSteps: async (justRan) => {
                if (FOCUS_CHANGING_ACTIONS.has(justRan.action)) await waitForForegroundSettle()
              },
            },
          ),
        )
      }

      const params = parseActOnDesktopParams(args, app)
      if (params === null) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Pass EITHER a single "action" (${DESKTOP_INPUT_ACTIONS.join(', ')}) ` +
                'OR "actions" for a batch.',
            },
          ],
          isError: true,
        }
      }
      try {
        const result = await actOnDesktop(params, effectiveAuthorize)
        // 'unverified' is the honest outcome for every coordinate act — a click
        // has no read-back, so the record says what was DONE, never that it
        // worked. Claiming otherwise is the fiction this arc exists to remove.
        envelope.recordAct({
          tool: 'act_on_desktop',
          appName: params.app ?? null,
          // recordDetail, NOT detail: the record is append-only, and `type`'s
          // detail carries what was typed.
          detail: result.recordDetail,
          outcome: 'unverified',
        })
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
