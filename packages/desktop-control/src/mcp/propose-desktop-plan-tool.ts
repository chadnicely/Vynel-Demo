// The plan-approval moment of desktop control: the model states the WHOLE task
// up front — goal, steps, every app it will touch — and the user approves ONCE.
// Declared in the descriptor's `askModeApprovalToolNames`, so in ask mode this
// call raises the (single) approval card; a denied card means this handler
// never runs, the envelope stays unarmed, and every act tool keeps refusing.
// In auto/bypass it runs uncarded (those modes are the standing consent), and
// on unattended turns it runs uncarded but the envelope is 'display-only' —
// the plan narrates on the overlay without authorizing anything.
//
// The handler is only the RECORDING of consent: arm the turn's envelope with
// the stated plan. What that arming authorizes is the envelope's business
// (consent mode), not this tool's.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  DESKTOP_ACCESS_TIERS,
  isDesktopAccessTier,
} from '../access/desktop-access-tiers.js'
import type { DesktopPlanApp, DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'

const TOOL_DESCRIPTION =
  'Propose your desktop plan BEFORE acting — required once per task, in every mode. State the goal, ' +
  'the steps a person can follow, and EVERY app you will act on with the lowest tier that does the ' +
  'job ("click" = press/mouse · "full" = also type/keys; app names must match list_open_apps ' +
  'exactly when the app is open). In ask mode the user approves the WHOLE plan on one card — then ' +
  'your actions run without per-step approvals. Steps must name irreversible outcomes explicitly ' +
  '(sending, deleting, paying): the approval covers only what the plan states, so an irreversible ' +
  'action you did not state still needs the user\'s confirmation. If the task changes or an act is ' +
  'denied for an app the plan missed, propose an updated plan (it replaces this one).'

const MAX_STEPS = 20
const MAX_APPS = 10
// Per-string caps keep the approval card readable — a plan the user can't
// take in at a glance is not a consent surface.
const MAX_STEP_LENGTH = 200
const MAX_APP_NAME_LENGTH = 120

/** Parse the loose SDK arg bag into a plan's apps — null on any invalid entry. */
export function parsePlanApps(raw: unknown): DesktopPlanApp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_APPS) return null
  const apps: DesktopPlanApp[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null
    const app = (entry as Record<string, unknown>)['app']
    const tier = (entry as Record<string, unknown>)['tier']
    if (typeof app !== 'string' || app.trim().length === 0) return null
    if (app.trim().length > MAX_APP_NAME_LENGTH) return null
    if (!isDesktopAccessTier(tier)) return null
    apps.push({ app: app.trim(), tier })
  }
  return apps
}

/** Parse the loose SDK arg bag into the steps list — null when unusable. */
export function parsePlanSteps(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STEPS) return null
  const steps: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return null
    if (entry.trim().length > MAX_STEP_LENGTH) return null
    steps.push(entry.trim())
  }
  return steps
}

function armedSummary(envelope: DesktopPlanEnvelope, apps: DesktopPlanApp[]): string {
  const appList = apps.map((planApp) => `"${planApp.app}" (${planApp.tier})`).join(', ')
  switch (envelope.consent) {
    case 'approval-card':
      return (
        `The user approved this plan. Authorized for THIS task: ${appList}. ` +
        'Act within the plan — no further approval cards for these steps. If the scope changes, ' +
        'propose an updated plan (the user approves the change once).'
      )
    case 'standing-consent':
      return (
        `Plan recorded — the user's current mode is standing consent, so its apps are authorized ` +
        `for this task: ${appList}. Proceed.`
      )
    case 'display-only':
      return (
        'Plan recorded and visible to the user. This unattended turn cannot authorize new apps — ' +
        'act within the user\'s standing grants; for an app without one, call ' +
        'request_desktop_access (the user decides).'
      )
  }
}

/** Construct the `propose_desktop_plan` SDK MCP tool (the ask-mode consent moment). */
export function makeProposeDesktopPlanTool(envelope: DesktopPlanEnvelope): unknown {
  return (tool as unknown as McpToolFn)(
    'propose_desktop_plan',
    TOOL_DESCRIPTION,
    {
      goal: z
        .string()
        .min(1)
        .max(500)
        .describe('One sentence: what the user asked for. The headline of the approval card.'),
      steps: z
        .array(z.string().min(1).max(MAX_STEP_LENGTH))
        .min(1)
        .max(MAX_STEPS)
        .describe('Short human-readable steps, in order. Name irreversible outcomes explicitly.'),
      apps: z
        .array(
          z.object({
            app: z
              .string()
              .min(1)
              .max(MAX_APP_NAME_LENGTH)
              .describe('App name — exactly as list_open_apps shows it when open.'),
            tier: z.enum(DESKTOP_ACCESS_TIERS).describe('Lowest tier that does the job.'),
          }),
        )
        .min(1)
        .max(MAX_APPS)
        .describe('Every app this plan will act on.'),
    },
    async (args: Record<string, unknown>) => {
      const goal = typeof args['goal'] === 'string' ? args['goal'].trim() : ''
      const steps = parsePlanSteps(args['steps'])
      const apps = parsePlanApps(args['apps'])
      if (goal.length === 0 || goal.length > 500 || steps === null || apps === null) {
        return {
          content: [
            {
              type: 'text',
              text:
                'A plan needs: goal (one sentence), steps (1-20 non-empty strings), and apps ' +
                '(1-10 entries of { app, tier: read | click | full }). Fix the invalid field and re-propose.',
            },
          ],
          isError: true,
        }
      }
      envelope.arm({ goal, steps, apps })
      return { content: [{ type: 'text', text: armedSummary(envelope, apps) }] }
    },
    // The consent moment of acting — destructive-tinted like request_desktop_access,
    // so no client ever treats it as a safe read.
    { annotations: { destructiveHint: true } },
  )
}
