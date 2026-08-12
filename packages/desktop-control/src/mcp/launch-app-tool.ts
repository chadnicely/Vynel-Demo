import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listInstalledApps, matchInstalledApps, type InstalledApp } from '../apps/installed-apps.js'
import { launchApp, type LaunchAppResult } from '../apps/launch-app.js'
import { listWindowAppNames } from '../a11y/window-identity.js'
import { normalizeDesktopAppKey } from '../access/desktop-access-tiers.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makePlanGatedAuthorizer, planRequiredError } from '../plan/plan-gated-authorization.js'
import { recordFailedAct } from '../plan/record-failed-act.js'

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

/**
 * `requestedName` is the name the plan/grant was taken under (the Start-menu
 * name). A launched window can report a DIFFERENT app name ("Firefox Developer
 * Edition" → "Firefox"), and enforcement always runs against the window's own
 * name — so a mismatch means the existing authorization does not cover what
 * just opened. Say so HERE, at the moment it becomes true, instead of letting
 * it surface later as a confusing denial on the first act.
 */
export function buildLaunchResponse(
  result: LaunchAppResult,
  requestedName?: string,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  // The SAME drift check both outcomes need. `already-open` needs it just as
  // much as `launched`: packaged apps enter the window roster under their
  // TITLE, so a document window ("Mail attachment.jpg - Photos") can satisfy a
  // loose match for "Mail" and be reported as the app. Naming the mismatch is
  // what stops the model targeting a document as though it were the program.
  const drifted =
    requestedName !== undefined &&
    normalizeDesktopAppKey(requestedName) !== normalizeDesktopAppKey(result.appName)

  if (result.kind === 'already-open') {
    return {
      content: [
        {
          type: 'text',
          text:
            `"${result.appName}" already has a window open — nothing was launched, which is what you ` +
            'want: activating an app that is already showing can pop an error dialog that then sits ' +
            `on screen looking like the app. Use "${result.appName}" for snapshot_app / screenshot_app ` +
            'and the act tools.' +
            (drifted
              ? ` NOTE: that window reports as "${result.appName}", not "${requestedName}" — check ` +
                'with list_open_apps that it really is the app you meant and not a document or ' +
                `helper window, and re-propose your plan for "${result.appName}" before acting.`
              : ' If it is not the window you expected, call list_open_apps.'),
        },
      ],
    }
  }
  if (result.kind === 'look-alike-only') {
    return {
      content: [
        {
          type: 'text',
          text:
            `"${result.appName}" did NOT open. A window called "${result.lookAlikeName}" appeared ` +
            'instead — a name that merely extends the app\'s, which is almost always the app ' +
            'refusing to start and saying why in a dialog. Do NOT target it as if it were the app, ' +
            `and do NOT just launch again. Read it — screenshot_app({ app: "${result.lookAlikeName}" }) ` +
            '— then tell the user what it says, because the fix is usually theirs to make.',
        },
      ],
      isError: true,
    }
  }
  if (result.kind === 'launched') {
    return {
      content: [
        {
          type: 'text',
          text:
            `"${result.appName}" is open. Use that exact name for snapshot_app / screenshot_app and ` +
            'the act tools.' +
            (drifted
              ? ` NOTE: it reports as "${result.appName}", not "${requestedName}" — a plan entry ` +
                `naming "${requestedName}" does NOT cover it. Propose an updated plan for ` +
                `"${result.appName}" before acting.`
              : ''),
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
  deps: LaunchAppToolDeps = {},
): unknown {
  const effectiveAuthorize = makePlanGatedAuthorizer(envelope)
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
        const launchResult = await launch(target, { listWindowAppNames })
        envelope.recordAct({
          tool: 'launch_app',
          appName: target.name,
          detail:
            launchResult.kind === 'already-open'
              ? 'was already open — nothing launched'
              : `launched (${launchResult.kind})`,
          // `started-no-window` is explicitly UNVERIFIED — the launch ran and
          // no window appeared. Recording it as `ok` would be the same
          // overstatement that let a launch which opened the Applications
          // folder report success for a whole day.
          outcome:
            launchResult.kind === 'look-alike-only'
              ? 'failed'
              : launchResult.kind === 'started-no-window'
                ? 'unverified'
                : 'ok',
          note: launchResult.kind === 'look-alike-only' ? launchResult.lookAlikeName : null,
        })
        return buildLaunchResponse(
          launchResult,
          // The name the authorization was taken under — so a window that
          // opens reporting something else is called out immediately.
          target.name,
        )
      } catch (err) {
        recordFailedAct(envelope, { tool: 'launch_app', appName: query, detail: 'launch threw' }, err)
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { destructiveHint: true } },
  )
}
