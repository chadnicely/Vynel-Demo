// The consent tool of the desktop access model: the ONLY way access comes
// into being. Declared in the descriptor's `mutatingToolNames`, so calling it
// raises an approval card in ASK mode (and in the unattended
// `bypass-with-behavior-gate` default) — the card (showing app + tier +
// reason) IS the user's consent moment there; a denied card means this
// handler never runs and no grant exists. In the user's AUTO/BYPASS the floor
// stands down and the grant is recorded without a card, per Chad's approval
// stance: those modes ARE the standing consent. The handler just records what
// was approved. Grants persist until revoked (Desktop access list).

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Database } from '@vynel/db'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listOpenApps, isAppNameMatch, type OpenApp } from '../a11y/xa11y-adapter.js'
import { listInstalledApps, type InstalledApp } from '../apps/installed-apps.js'
import {
  listWindowAppNames,
  findAppNameByPid,
  resolveAppIdentity,
} from '../a11y/window-identity.js'
import { grantDesktopAccess } from '../access/grant-desktop-access.js'
import {
  DESKTOP_ACCESS_TIERS,
  isDesktopAccessTier,
  normalizeDesktopAppKey,
} from '../access/desktop-access-tiers.js'

const TOOL_DESCRIPTION =
  'Ask the user to grant you desktop access to ONE app, at a tier: "read" (see it — snapshot/screenshot) · ' +
  '"click" (also press elements / mouse actions) · "full" (also type text / press keys). The user sees an ' +
  'approval card with the app, tier and your reason — request the LOWEST tier that does the job, and only ' +
  'for the app the user asked you to work with. The app does NOT have to be running: names are resolved ' +
  'against open windows AND installed apps, so you can be granted access to something you are about to ' +
  'launch. Use the EXACT name (from list_open_apps if open, else list_installed_apps). Access persists ' +
  'until the user revokes it. If a desktop tool was denied for a missing grant, this is the recovery path.'

export type RequestDesktopAccessDeps = {
  /** Injectable for tests — production resolves against the live window list. */
  listApps?: () => Promise<OpenApp[]>
  now?: () => Date
}

/**
 * The apps a grant can name, UNIONED across every identity source and reduced
 * to CANONICAL app identities.
 *
 * Three sources are needed. xa11y's `App.list()` misses the Electron/Chromium
 * class (tree off until woken), while the window source sees every real
 * window; but xa11y names apps by WINDOW TITLE, so each of its entries is
 * mapped through its pid to the real app name first — otherwise a grant lands
 * under "Vynel – Google Chrome" and stops matching the moment the user
 * switches tabs (live smoke, 2026-08-04). The INSTALLED roster is the third
 * (Kafi 2026-08-11): without it a CLOSED app could never be granted, so
 * "open Chrome and search YouTube" from a channel dead-ended — the unattended
 * turn can't self-grant, and the only grant door refused to name anything that
 * wasn't already on screen.
 *
 * ORDER IS LOAD-BEARING: live-window names come FIRST so they win the dedupe.
 * Enforcement always runs against the name the RUNNING window reports, so when
 * an app is open its own name must be the one granted — the Start-menu name is
 * only the fallback for something not yet launched.
 *
 * A source that fails to load contributes nothing; if ALL fail, the first
 * failure surfaces (never a silent empty list).
 */
export async function listGrantableApps(
  deps: {
    windowAppNames?: () => string[]
    appNameByPid?: (pid: number) => string | null
    accessibilityApps?: () => Promise<OpenApp[]>
    installedApps?: () => Promise<InstalledApp[]>
  } = {},
): Promise<OpenApp[]> {
  const windowAppNames = deps.windowAppNames ?? listWindowAppNames
  const appNameByPid = deps.appNameByPid ?? findAppNameByPid
  const accessibilityApps = deps.accessibilityApps ?? listOpenApps
  const installedApps = deps.installedApps ?? (() => listInstalledApps())
  const failures: unknown[] = []
  const seen = new Set<string>()
  const apps: OpenApp[] = []
  const add = (name: string, pid: number | null) => {
    const key = normalizeDesktopAppKey(name)
    if (key.length === 0 || seen.has(key)) return
    seen.add(key)
    apps.push({ name, pid })
  }
  try {
    for (const name of windowAppNames()) add(name, null)
  } catch (err) {
    failures.push(err)
  }
  try {
    for (const app of await accessibilityApps()) {
      // Canonicalize through the pid — never grant a window title.
      add(resolveAppIdentity(app.pid, app.name, appNameByPid), app.pid)
    }
  } catch (err) {
    failures.push(err)
  }
  try {
    // Last: a running app's own name already claimed its key above.
    for (const app of await installedApps()) add(app.name, null)
  } catch (err) {
    failures.push(err)
  }
  if (apps.length === 0 && failures.length > 0) throw failures[0]
  return apps
}

/**
 * Resolve the requested app — exported for tests. A grant is made ONLY on an
 * EXACT normalized-key match: the approval card shows the model's `app`
 * argument verbatim, so the name the user approves must be the name that gets
 * granted (a unique fuzzy match could grant an app the card never named). A
 * fuzzy match comes back as a suggestion to re-request with the exact name;
 * distinct-key ambiguity lists the candidates instead of guessing.
 */
export function resolveRequestedApp(
  apps: OpenApp[],
  query: string,
):
  | { kind: 'resolved'; appName: string }
  | { kind: 'none' }
  | { kind: 'suggestion'; appName: string }
  | { kind: 'ambiguous'; names: string[] } {
  const queryKey = normalizeDesktopAppKey(query)
  const exact = apps.find((app) => normalizeDesktopAppKey(app.name) === queryKey)
  if (exact !== undefined) return { kind: 'resolved', appName: exact.name }

  const matches = apps.filter((app) => isAppNameMatch(app.name, query))
  const distinctKeys = new Map<string, string>()
  for (const match of matches) {
    const key = normalizeDesktopAppKey(match.name)
    // First-seen display name wins — same-key windows are ONE app.
    if (!distinctKeys.has(key)) distinctKeys.set(key, match.name)
  }
  if (distinctKeys.size === 0) return { kind: 'none' }
  if (distinctKeys.size > 1) return { kind: 'ambiguous', names: [...distinctKeys.values()] }
  const [appName] = distinctKeys.values()
  return { kind: 'suggestion', appName: appName ?? query }
}

/** Construct the `request_desktop_access` SDK MCP tool (every-mode approval card). */
export function makeRequestDesktopAccessTool(
  db: Database,
  userId: string,
  deps: RequestDesktopAccessDeps = {},
): unknown {
  const listApps = deps.listApps ?? listGrantableApps
  const now = deps.now ?? (() => new Date())
  return (tool as unknown as McpToolFn)(
    'request_desktop_access',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .min(1)
        .describe('The app to request access to (name or distinctive substring; match list_open_apps).'),
      tier: z
        .enum(DESKTOP_ACCESS_TIERS)
        .describe('read (see) · click (also press/mouse) · full (also type/keys). Request the lowest that works.'),
      reason: z
        .string()
        .min(1)
        .describe('One sentence for the user: what you need to do in this app and why.'),
    },
    async (args: Record<string, unknown>) => {
      const query = typeof args['app'] === 'string' ? args['app'].trim() : ''
      const tier = isDesktopAccessTier(args['tier']) ? args['tier'] : null
      if (query.length === 0 || tier === null) {
        return {
          content: [
            { type: 'text', text: 'Both "app" and a valid "tier" (read | click | full) are required.' },
          ],
          isError: true,
        }
      }
      try {
        const resolved = resolveRequestedApp(await listApps(), query)
        if (resolved.kind === 'none') {
          return {
            content: [
              {
                type: 'text',
                text: `Nothing matches "${query}" — access is granted to a RESOLVED app, not a free-text name. Call list_open_apps (if it is running) or list_installed_apps (if it is not) and re-request with an exact name from that list.`,
              },
            ],
            isError: true,
          }
        }
        if (resolved.kind === 'ambiguous') {
          return {
            content: [
              {
                type: 'text',
                text: `"${query}" matches more than one app (${resolved.names.join(', ')}) — no grant was made. Re-request with ONE exact name.`,
              },
            ],
            isError: true,
          }
        }
        if (resolved.kind === 'suggestion') {
          // Consent fidelity: the card the user approves shows the model's
          // `app` argument — a fuzzy grant would name something the card
          // didn't. Refuse and have the model re-request exactly.
          return {
            content: [
              {
                type: 'text',
                text: `No app is named exactly "${query}" — did you mean "${resolved.appName}"? No grant was made. Re-request with the EXACT name, so the approval card names exactly what gets granted.`,
              },
            ],
            isError: true,
          }
        }
        const granted = grantDesktopAccess(db, {
          userId,
          appName: resolved.appName,
          tier,
          now: now(),
        })
        const summary =
          granted.outcome === 'unchanged'
            ? `Access to "${resolved.appName}" already covers "${tier}" (granted tier: "${granted.grant.tier}").`
            : `The user granted "${granted.grant.tier}" access to "${resolved.appName}".`
        return { content: [{ type: 'text', text: summary }] }
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
