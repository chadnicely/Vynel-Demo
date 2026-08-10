import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listInstalledApps, matchInstalledApps, type InstalledApp } from '../apps/installed-apps.js'
import { launchApp, type LaunchAppResult } from '../apps/launch-app.js'
import { listWindowAppNames } from '../a11y/window-identity.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makePlanGatedAuthorizer, planRequiredError } from '../plan/plan-gated-authorization.js'

// Starting a program is an ACTION, so it sits inside the same envelope every
// other act does: plan first, then authorization against the RESOLVED app.
//
// The required tier is "click", not "read": the "look only" tier is a promise
// that Claude will observe and not touch, and starting a program is touching.
// That also keeps the blast radius sane — the model cannot start something the
// user never put in a plan or granted (cmd.exe, an installer), because the
// authorizer is the same one the act tools use.

const TOOL_DESCRIPTION =
  'Start an installed app that is not running yet, and wait for its window to appear. Requires a plan ' +
  '(propose_desktop_plan) naming this app, exactly as list_installed_apps shows it. Pass `app` = the ' +
  "app's name; if several match you get the candidates back and nothing is launched, so re-call with " +
  'the exact name. Returns the window name that appeared — use THAT for snapshot_app and the act ' +
  'tools. If the app is ALREADY open (check list_open_apps first), do not launch it again — just ' +
  'target it. Windows only.'

export function buildLaunchResponse(
  result: LaunchAppResult,
): { content: Array<{ type: 'text'; text: string }> } {
  if (result.kind === 'launched') {
    return {
      content: [
        {
          type: 'text',
          text:
            `"${result.appName}" is open. Use that exact name for snapshot_app / screenshot_app and ` +
            'the act tools.',
        },
      ],
    }
  }
  return {
    content: [
      {
        type: 'text',
        text:
          `Started "${result.appName}", but no matching window appeared yet — it may still be loading, ` +
          'or its window may be named differently. Call list_open_apps to see what is actually open ' +
          'before acting.',
      },
    ],
  }
}

export type LaunchAppToolDeps = {
  listApps?: () => Promise<InstalledApp[]>
  launch?: typeof launchApp
}

/** Construct the `launch_app` SDK MCP tool (mutating — destructiveHint).
 *  Plan-gated by construction, exactly like the act tools. */
export function makeLaunchAppTool(
  envelope: DesktopPlanEnvelope,
  authorize?: DesktopAccessAuthorizer,
  deps: LaunchAppToolDeps = {},
): unknown {
  const effectiveAuthorize = makePlanGatedAuthorizer(envelope, authorize)
  const listApps = deps.listApps ?? (() => listInstalledApps())
  const launch = deps.launch ?? launchApp
  return (tool as unknown as McpToolFn)(
    'launch_app',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .min(1)
        .describe('The installed app to start — the name exactly as list_installed_apps shows it.'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = planRequiredError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const query = typeof args['app'] === 'string' ? args['app'].trim() : ''
      if (query.length === 0) {
        return { content: [{ type: 'text', text: 'An app name is required.' }], isError: true }
      }
      try {
        const matches = matchInstalledApps(await listApps(), query)
        const exact = matches.find((app) => app.name.toLowerCase() === query.toLowerCase())
        if (matches.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No installed app matches "${query}". Call list_installed_apps to see what is available.`,
              },
            ],
            isError: true,
          }
        }
        // Ambiguity never guesses: launching the wrong program is a visible,
        // annoying side effect the user has to undo (mirrors the grant door's
        // exact-name rule).
        if (exact === undefined && matches.length > 1) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `"${query}" matches ${matches.length} installed apps — nothing was launched. ` +
                  `Re-call with ONE exact name: ${matches.slice(0, 8).map((app) => `"${app.name}"`).join(', ')}.`,
              },
            ],
            isError: true,
          }
        }
        const target = exact ?? matches[0]!
        // Authorize the app the user actually approved, BEFORE starting it.
        effectiveAuthorize(target.name, 'click')
        return buildLaunchResponse(
          await launch(target, { listWindowAppNames }),
        )
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
