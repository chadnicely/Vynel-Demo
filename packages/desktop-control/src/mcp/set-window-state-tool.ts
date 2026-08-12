// Arrange a window — maximize it to make an app usable, minimize it to clear
// it away, or restore it to a normal frame. The deliberate counterpart to the
// AUTOMATIC restore that snapshot_app / act tools do on a minimized window:
// this is Claude choosing a window state on purpose (Kafi 2026-08-11 — "app
// option to max, minimize option").
//
// A window-state change is a `click`-class desktop change (it alters the
// screen, but types nothing), so it enforces the `click` tier — and it is
// PLAN-GATED by construction, exactly like the act tools: no armed plan, no
// arranging.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  findWindowedPidByName,
  isProcessRunningByName,
  trayHiddenMessage,
} from '../a11y/windowed-process.js'
import { resolveAppIdentity } from '../a11y/window-identity.js'
import { hostedAmbiguityMessage } from '../a11y/window-host-processes.js'
import { setWindowState, windowStateVerb, WINDOW_STATES, isWindowState } from '../a11y/window-state.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makePlanGatedAuthorizer, planRequiredError } from '../plan/plan-gated-authorization.js'

const TOOL_DESCRIPTION =
  'Arrange an app window: "maximized" (fill the screen — do this to make an app you launched usable), ' +
  '"minimized" (tuck it out of the way), or "restored" (a normal, un-maximized window). Requires a ' +
  'plan (propose_desktop_plan) naming the app. You do NOT need this just to read or act on a ' +
  'minimized app — snapshot_app, screenshot_app and the act tools restore it for you. Reach for this ' +
  'when the window STATE itself is the goal. Pass `app` = the app name (match list_open_apps). ' +
  'Windows only.'

export type SetWindowStateToolDeps = {
  findPid?: (query: string) => Promise<number | null>
  isRunning?: (query: string) => Promise<boolean>
  /** Injectable so the tool's tests never load the capture binary (the
   *  `request_desktop_access` precedent) — the default reaches node-screenshots. */
  appNameByPid?: (pid: number) => string | null
  apply?: typeof setWindowState
}

/** Construct the `set_window_state` SDK MCP tool (mutating — destructiveHint).
 *  Plan-gated by construction, exactly like the act tools. */
export function makeSetWindowStateTool(
  envelope: DesktopPlanEnvelope,
  deps: SetWindowStateToolDeps = {},
): unknown {
  const effectiveAuthorize = makePlanGatedAuthorizer(envelope)
  const findPid = deps.findPid ?? findWindowedPidByName
  const isRunning = deps.isRunning ?? isProcessRunningByName
  const apply = deps.apply ?? setWindowState
  const appNameByPid = deps.appNameByPid
  return (tool as unknown as McpToolFn)(
    'set_window_state',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .min(1)
        .describe('The app/window to arrange (name or a distinctive substring; match list_open_apps).'),
      state: z
        .enum(WINDOW_STATES)
        .describe('maximized (fill the screen) · minimized (tuck away) · restored (normal window).'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = planRequiredError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const query = typeof args['app'] === 'string' ? args['app'].trim() : ''
      const state = isWindowState(args['state']) ? args['state'] : null
      if (query.length === 0 || state === null) {
        return {
          content: [
            { type: 'text', text: 'Both "app" and a valid "state" (maximized | minimized | restored) are required.' },
          ],
          isError: true,
        }
      }
      try {
        const pid = await findPid(query)
        if (pid === null) {
          return {
            content: [
              {
                type: 'text',
                // Same tray distinction as set_window_bounds: findWindowedPidByName
                // filters MainWindowHandle -ne 0, so a tray app reaches here even
                // though it is running. "Not open" would be false.
                text: (await isRunning(query))
                  ? trayHiddenMessage(query, "arrange")
                  : `No open window matches "${query}". Call list_open_apps to see what's open (the app must be running).`,
              },
            ],
            isError: true,
          }
        }
        // Resolve the canonical identity, then enforce the click tier against
        // it — never the fuzzy query. The fallback is '' rather than `query`
        // because the query is what the MODEL asked for, not what was found:
        // packaged apps share one pid, and `apply` actuates that pid's
        // MainWindowHandle, so trusting the query would let "minimize
        // Calculator" authorize as Calculator and minimize Settings.
        const appName =
          appNameByPid !== undefined
            ? resolveAppIdentity(pid, '', appNameByPid)
            : resolveAppIdentity(pid, '')
        if (appName.length === 0) {
          return {
            content: [{ type: 'text', text: hostedAmbiguityMessage(query, 'changed') }],
            isError: true,
          }
        }
        effectiveAuthorize(appName, 'click')
        // Report the VERIFIED outcome — claiming a state the window never
        // reached would have the model build its next step on a fiction.
        if (!(await apply(pid, state))) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Could not ${state === 'restored' ? 'restore' : state.replace(/d$/, '')} ` +
                  `"${appName}" — the window didn't reach that state (it may have no reachable ` +
                  'main window). Call list_open_apps to see what is actually open.',
              },
            ],
            isError: true,
          }
        }
        envelope.recordAct({
          tool: 'set_window_state',
          appName,
          detail: `${windowStateVerb(state)} the window`,
          outcome: 'ok',
        })
        return {
          content: [{ type: 'text', text: `"${appName}" is ${windowStateVerb(state)}.` }],
        }
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
