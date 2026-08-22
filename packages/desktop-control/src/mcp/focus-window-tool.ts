// Bring a window to the FRONT — the lever that did not exist.
//
// Kafi, 2026-08-22: *"In our tool we have a maximize option but no option to
// bring any background window to foreground — there is no function we have
// yet."* Focusing only ever happened as a SIDE EFFECT of resolving an app for a
// snapshot or an act, so "bring X to the front" was not a thing the model could
// ask for. `set_window_state: maximized` is not a substitute: under an armed
// foreground lock `ShowWindow` returns True 3/3 while the foreground never
// moves, so it fails by lying.
//
// Window-addressed, not app-addressed. One app commonly owns several windows
// (three Chrome windows on one pid, measured), so the tool takes an optional
// `window` title hint, picks the most-recently-in-front match otherwise, and
// ALWAYS names the window it raised — plus the ones it passed over, so a wrong
// pick is recoverable in one retry instead of being invisible.
//
// Raising is a `click`-class change (it alters the screen, types nothing) and
// is PLAN-GATED by construction, exactly like the other act tools.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { McpToolFn } from "@vynel/mcp-contract";
import {
  listDesktopWindows,
  selectWindow,
  type DesktopWindow,
} from "../a11y/desktop-windows.js";
import { focusWindowHandle } from "../a11y/window-focus.js";
import {
  isProcessRunningByName,
  trayHiddenMessage,
} from "../a11y/windowed-process.js";
import type { DesktopPlanEnvelope } from "../plan/desktop-plan-envelope.js";
import {
  makePlanGatedAuthorizer,
  planRequiredError,
} from "../plan/plan-gated-authorization.js";
import { recordFailedAct } from "../plan/record-failed-act.js";

const TOOL_DESCRIPTION =
  "Bring an app window to the FRONT (focus/raise it) so the user can see it, or so a following " +
  "click or keystroke lands in it. Requires a plan (propose_desktop_plan) naming the app. Un-minimizes " +
  "a minimized window and preserves whether it was maximized — it never resizes the window; use " +
  "set_window_state if the window SIZE is the goal. If the app has several windows, pass `window` with " +
  "part of the title to pick one; otherwise the most recently used one is raised and the response " +
  "names it plus any alternatives. Windows only.";

/** Compact per-window shape for the response — enough for the model to retry
 *  naming a different window, and nothing it cannot act on. */
function describeWindow(window: DesktopWindow): {
  title: string;
  minimized: boolean;
} {
  return { title: window.title, minimized: window.minimized };
}

export function buildFocusWindowResponse(
  appName: string,
  raised: DesktopWindow,
  alternatives: readonly DesktopWindow[],
): { content: Array<{ type: "text"; text: string }> } {
  const titled =
    raised.title.trim().length > 0 ? `"${raised.title}"` : "its window";
  const base = `"${appName}" is now in front — ${titled}.`;
  if (alternatives.length === 0) {
    return { content: [{ type: "text", text: base }] };
  }
  // Naming what was passed over is what makes a wrong pick RECOVERABLE. A bare
  // "ok" would hide the entire multi-window failure mode.
  return {
    content: [
      {
        type: "text",
        text:
          `${base}\n\n"${appName}" has ${alternatives.length + 1} windows. If you wanted a ` +
          `different one, call focus_window again with "window" set to part of its title:\n` +
          JSON.stringify(alternatives.map(describeWindow), null, 2),
      },
    ],
  };
}

export type FocusWindowToolDeps = {
  /** Injectable so the tool's tests never load the capture binary — the
   *  `set_window_state` precedent. */
  listWindows?: () => DesktopWindow[];
  focus?: (handle: number) => Promise<boolean>;
  isRunning?: (query: string) => Promise<boolean>;
};

/** Construct the `focus_window` SDK MCP tool (mutating — destructiveHint).
 *  Plan-gated by construction, exactly like the act tools. */
export function makeFocusWindowTool(
  envelope: DesktopPlanEnvelope,
  deps: FocusWindowToolDeps = {},
): unknown {
  const effectiveAuthorize = makePlanGatedAuthorizer(envelope);
  const listWindows = deps.listWindows ?? listDesktopWindows;
  const focus = deps.focus ?? focusWindowHandle;
  const isRunning = deps.isRunning ?? isProcessRunningByName;
  return (tool as unknown as McpToolFn)(
    "focus_window",
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .min(1)
        .describe(
          "The app to bring forward (name or a distinctive substring; match list_open_apps).",
        ),
      window: z
        .string()
        .optional()
        .describe(
          "Optional: part of the window TITLE, when the app has more than one window open.",
        ),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = planRequiredError(envelope);
      if (planRefusal !== null) {
        return {
          content: [{ type: "text", text: planRefusal }],
          isError: true,
        };
      }
      const query = typeof args["app"] === "string" ? args["app"].trim() : "";
      const windowHint =
        typeof args["window"] === "string" ? args["window"].trim() : "";
      if (query.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: 'An "app" to bring to the front is required.',
            },
          ],
          isError: true,
        };
      }
      try {
        const match = selectWindow(
          listWindows(),
          query,
          windowHint.length > 0 ? windowHint : undefined,
        );
        if (match === null) {
          // A hint that matched nothing and an app that is not open are
          // different problems and need opposite advice — saying "not open"
          // about an app whose window title simply differs sends the model to
          // launch_app for something already running.
          if (windowHint.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `No "${query}" window has a title matching "${windowHint}". Call list_open_apps ` +
                    "to see the exact window titles, then retry.",
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                // Same tray distinction the other window tools make: a
                // tray-hidden app IS running but owns no window to raise.
                text: (await isRunning(query))
                  ? trayHiddenMessage(query, "bring to the front")
                  : `No open window matches "${query}". Call list_open_apps to see what's open.`,
              },
            ],
            isError: true,
          };
        }
        // Enforce against the RESOLVED identity, never the fuzzy query — the
        // window carries its own canonical app name, so "focus Calculator" can
        // never authorize as Calculator while raising Settings.
        const appName = match.window.appName;
        effectiveAuthorize(appName, "click");
        if (!(await focus(match.window.handle))) {
          // Report the VERIFIED outcome. Two of the techniques Windows refuses
          // return `True`, so a focus tool that trusted a boolean would claim
          // success while nothing moved.
          envelope.recordAct({
            tool: "focus_window",
            appName,
            detail: "could not take the foreground",
            outcome: "failed",
          });
          return {
            content: [
              {
                type: "text",
                text:
                  `Could not bring "${appName}" to the front — Windows refused the focus change. ` +
                  "This usually means the window needs administrator rights, or the user is actively " +
                  "typing elsewhere. Ask the user to click the window once, then retry.",
              },
            ],
            isError: true,
          };
        }
        envelope.recordAct({
          tool: "focus_window",
          appName,
          detail: `brought "${match.window.title}" to the front`,
          outcome: "ok",
        });
        return buildFocusWindowResponse(
          appName,
          match.window,
          match.alternatives,
        );
      } catch (err) {
        recordFailedAct(
          envelope,
          { tool: "focus_window", appName: query, detail: "focus threw" },
          err,
        );
        return {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    },
    { annotations: { destructiveHint: true } },
  );
}
