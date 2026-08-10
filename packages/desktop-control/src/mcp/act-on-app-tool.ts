import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  actOnApp,
  actionRequiresValue,
  DESKTOP_ACTIONS,
  type ActOnAppResult,
  type DesktopAction,
} from '../a11y/xa11y-adapter.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makePlanGatedAuthorizer, planRequiredError } from '../plan/plan-gated-authorization.js'
import {
  buildBatchResponse,
  runActionBatch,
  MAX_BATCH_ACTIONS,
  type BatchStepResult,
} from './act-batch.js'

const TOOL_DESCRIPTION =
  "Act on elements in a desktop app — click, type, or set a value. This CHANGES things on the user's " +
  'screen. Requires a plan: call propose_desktop_plan first (once per task). First call snapshot_app to ' +
  'see each element\'s role + name, then target it: `app` = the app name; ' +
  '`selector` = `role[name="X"]` (e.g. button[name="Save"]) or `[stable_id="…"]` for precision; `action` = ' +
  'press (click) / type_text / set_value; `value` = the text for type_text or set_value. ' +
  'BATCH RELATED STEPS: pass `actions` = [{selector, action, value?}, …] to run several in ONE call ' +
  '(e.g. type into a field, then press the button) — much faster than one call per step. They run in ' +
  'order and STOP at the first failure, which is reported with what did and did not run. Use the single ' +
  'form when you must see the result before choosing the next step. If a selector matches more than one ' +
  'element, NO action runs — you get the matches with their stable_ids, so re-target ONE precisely. ' +
  'IMPORTANT: an IRREVERSIBLE action (sending a message, deleting, paying, submitting a form) must be ' +
  'stated in the approved plan — one that is not still needs the user\'s confirmation first. Windows only.'

function parseAction(raw: unknown): DesktopAction | null {
  return typeof raw === 'string' && (DESKTOP_ACTIONS as readonly string[]).includes(raw)
    ? (raw as DesktopAction)
    : null
}

/** One step of a batch — the same three fields the single form takes (the app
 *  is the batch's, so a call can't wander into an app the step didn't name). */
export type ActOnAppStep = { selector: string; action: DesktopAction; value?: string }

/**
 * Parse the loose `actions` arg into steps — null when absent or unusable, so
 * the handler can tell "no batch" from "bad batch" by checking the raw arg.
 * Validates EVERY step up front (including the value an action requires) so a
 * malformed batch fails ATOMICALLY: with N separate calls a bad call mutated
 * nothing, and a half-executed batch would leave the screen part-way through.
 */
export function parseActOnAppSteps(raw: unknown): ActOnAppStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH_ACTIONS) return null
  const steps: ActOnAppStep[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null
    const bag = entry as Record<string, unknown>
    const selector = bag['selector']
    const action = parseAction(bag['action'])
    const value = bag['value']
    if (typeof selector !== 'string' || selector.trim().length === 0 || action === null) return null
    if (value !== undefined && typeof value !== 'string') return null
    if (actionRequiresValue(action) && typeof value !== 'string') return null
    steps.push({
      selector: selector.trim(),
      action,
      ...(typeof value === 'string' ? { value } : {}),
    })
  }
  return steps
}

/** The single-action result flattened into a batch step outcome — an ambiguous
 *  selector is a STOP (nothing ran), not an exception. */
export function toBatchStep(app: string, result: ActOnAppResult): BatchStepResult {
  const text = buildActResponse(app, result).content[0]?.text ?? ''
  return { ok: result.kind !== 'ambiguous', detail: text }
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

/** Construct the `act_on_app` SDK MCP tool (mutating — destructiveHint).
 *  The envelope is REQUIRED — acting is PLAN-GATED by construction: refused
 *  until the turn's plan is armed, and the armed plan authorizes its apps
 *  alongside standing grants. (An optional envelope would be a fail-open
 *  default waiting for a second construction site.) */
export function makeActOnAppTool(
  envelope: DesktopPlanEnvelope,
  authorize?: DesktopAccessAuthorizer,
): unknown {
  const effectiveAuthorize = makePlanGatedAuthorizer(envelope, authorize)
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
        .optional()
        .describe('Single action: element selector from snapshot_app — `role[name="…"]` or `[stable_id="…"]`.'),
      action: z.enum(DESKTOP_ACTIONS).optional().describe('Single action: press (click) · type_text · set_value.'),
      value: z.string().optional().describe('The text to enter, for type_text or set_value.'),
      actions: z
        .array(
          z.object({
            selector: z.string().min(1).describe('Element selector from snapshot_app.'),
            action: z.enum(DESKTOP_ACTIONS).describe('press (click) · type_text · set_value.'),
            value: z.string().optional().describe('The text, for type_text or set_value.'),
          }),
        )
        .min(1)
        .max(MAX_BATCH_ACTIONS)
        .optional()
        .describe('Batch: several actions in this app, run in order, stopping at the first failure.'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = planRequiredError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const app = typeof args['app'] === 'string' ? args['app'] : ''
      const batched = args['actions'] !== undefined

      if (batched) {
        if (args['action'] !== undefined || args['selector'] !== undefined) {
          return {
            content: [
              {
                type: 'text',
                text: 'Pass EITHER a single action ("selector" + "action") OR "actions" — not both.',
              },
            ],
            isError: true,
          }
        }
        const steps = parseActOnAppSteps(args['actions'])
        if (steps === null) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `"actions" must be 1-${MAX_BATCH_ACTIONS} entries of ` +
                  `{ selector, action: ${DESKTOP_ACTIONS.join(' | ')}, value? } — and type_text / ` +
                  'set_value each need their "value". Nothing ran.',
              },
            ],
            isError: true,
          }
        }
        // Each step re-resolves + re-authorizes inside actOnApp — batching is a
        // convenience over N calls, never a shortcut past the gate.
        return buildBatchResponse(
          await runActionBatch(steps, async (step) =>
            toBatchStep(app, await actOnApp(app, step.selector, step.action, step.value, effectiveAuthorize)),
          ),
        )
      }

      const action = parseAction(args['action'])
      const selector = typeof args['selector'] === 'string' ? args['selector'] : ''
      if (action === null || selector.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Pass EITHER a single action ("selector" + "action": ${DESKTOP_ACTIONS.join(', ')}) ` +
                'OR "actions" for a batch.',
            },
          ],
          isError: true,
        }
      }
      try {
        const value = typeof args['value'] === 'string' ? args['value'] : undefined
        return buildActResponse(app, await actOnApp(app, selector, action, value, effectiveAuthorize))
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
