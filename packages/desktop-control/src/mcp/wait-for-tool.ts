// `wait_for` — the observe-until-condition primitive.
//
// READ-ONLY: it changes nothing, so it needs no plan. It DOES read an app's
// content for the text conditions, which is exactly what `snapshot_app` needs a
// `read` grant for — so those enforce the same tier, against the resolved app,
// before the first look. The existence conditions read only the open-app list,
// which is ungated for the same reason `list_open_apps` is.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listOpenApps, snapshotApp } from '../a11y/xa11y-adapter.js'
import { isAppNameMatch } from '../a11y/app-name-match.js'
import {
  clampWaitTimeout,
  conditionReadsContent,
  isWaitCondition,
  waitForCondition,
  MAX_WAIT_TIMEOUT_MS,
  WAIT_CONDITIONS,
  type WaitClock,
  type WaitProbes,
} from '../a11y/wait-for-condition.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'

const TOOL_DESCRIPTION =
  'Wait until something on screen changes, instead of screenshotting over and over. READ-ONLY, no ' +
  'plan needed. Use it after any action that takes a moment — a page loading, a dialog opening, a ' +
  'spinner clearing, a file finishing. Conditions: "text_appears" / "text_disappears" (needs `text`; ' +
  'matches anywhere in the app, case-insensitive) · "app_appears" / "app_closes" (the window opening ' +
  `or going away). Give up after \`timeoutMs\` (default 15s, max ${MAX_WAIT_TIMEOUT_MS / 1000}s). It ` +
  'returns as soon as the condition is true — including immediately, if it already was. A timeout is ' +
  'NOT an error to retry blindly: look at the app and find out what actually happened. Windows only.'

export type WaitForToolDeps = { probes?: WaitProbes; clock?: WaitClock }

const realClock: WaitClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

function makeRealProbes(authorize?: DesktopAccessAuthorizer): WaitProbes {
  return {
    // `snapshotApp` authorizes the RESOLVED app at `read` internally, so a
    // grant check happens on every poll rather than once up front — a grant
    // revoked mid-wait stops the wait.
    readTree: async (app) => (await snapshotApp(app, {}, authorize)).tree,
    isAppOpen: async (app) => (await listOpenApps()).some((open) => isAppNameMatch(open.name, app)),
  }
}

/** Construct the read-only `wait_for` SDK MCP tool. */
export function makeWaitForTool(
  authorize?: DesktopAccessAuthorizer,
  deps: WaitForToolDeps = {},
): unknown {
  const probes = deps.probes ?? makeRealProbes(authorize)
  const clock = deps.clock ?? realClock
  return (tool as unknown as McpToolFn)(
    'wait_for',
    TOOL_DESCRIPTION,
    {
      app: z.string().min(1).describe('The app to watch (name or a distinctive part of it).'),
      until: z.enum(WAIT_CONDITIONS).describe('What to wait for.'),
      text: z
        .string()
        .optional()
        .describe('The text to wait for — required by text_appears / text_disappears.'),
      timeoutMs: z
        .number()
        .optional()
        .describe(`How long to wait before giving up (default 15000, max ${MAX_WAIT_TIMEOUT_MS}).`),
    },
    async (args: Record<string, unknown>) => {
      const app = typeof args['app'] === 'string' ? args['app'].trim() : ''
      const until = args['until']
      const text = typeof args['text'] === 'string' ? args['text'] : undefined
      if (app.length === 0 || !isWaitCondition(until)) {
        return {
          content: [
            { type: 'text', text: 'Both "app" and a valid "until" condition are required.' },
          ],
          isError: true,
        }
      }
      // Fail closed on the missing argument rather than waiting out the whole
      // timeout against an empty string, which every tree trivially contains.
      if (conditionReadsContent(until) && (text === undefined || text.length === 0)) {
        return {
          content: [
            { type: 'text', text: `The "${until}" condition needs a non-empty "text" to look for.` },
          ],
          isError: true,
        }
      }
      const timeoutMs = clampWaitTimeout(
        typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : undefined,
      )
      try {
        const outcome = await waitForCondition(
          { kind: until, app, ...(text !== undefined ? { text } : {}), timeoutMs },
          probes,
          clock,
        )
        const seconds = (outcome.elapsedMs / 1000).toFixed(1)
        if (outcome.met) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Condition "${until}" met after ${seconds}s (${outcome.attempts} check` +
                  `${outcome.attempts === 1 ? '' : 's'}).`,
              },
            ],
          }
        }
        // A timeout is reported as an error so it can't read as success, but the
        // message steers to observation rather than a blind retry.
        const errorNote =
          outcome.lastError !== undefined ? ` Last read failed: ${outcome.lastError}` : ''
        return {
          content: [
            {
              type: 'text',
              text:
                `Gave up waiting for "${until}" after ${seconds}s.${errorNote} Do NOT just wait ` +
                'again — look at the app (snapshot_app / screenshot_app) and work out what ' +
                'actually happened; it may need a different step, or the user.',
            },
          ],
          isError: true,
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )
}
