import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpToolFn } from "@vynel/mcp-contract";
import { listOpenApps, type OpenApp } from "../a11y/xa11y-adapter.js";
import {
  listDesktopWindows,
  type DesktopWindow,
} from "../a11y/desktop-windows.js";

// The `accessTier` column is GONE with the per-app grant model (2026-08-13).
// It survived the removal for one commit, defaulting to "none" for every app on
// every turn while its description told the model to fix that with
// `request_desktop_access` — a tool that no longer exists. A uniformly false
// field on the tool the instructions say to call FIRST is worse than no field.
// There is nothing to report in its place: looking is ungated, and what may be
// ACTED on is whatever the turn's approved plan names.
//
// TWO SOURCES, deliberately (2026-08-22). `apps` is xa11y's `App.list()` — the
// accessibility roster the snapshot/act tools resolve against, whose `name` is
// really the WINDOW TITLE and which cannot see Electron apps at all (their tree
// is off until woken). `windows` is the real window list from the capture
// source, which sees everything and separates an app's windows from each other.
//
// Keeping both is not redundancy: the model targets snapshot_app/act_on_app by
// the name in `apps`, and needs `windows` to know that "Chrome" is three
// windows before it can name the one it means. Neither list can answer both
// questions. Measured: Chrome ran 3 windows on one pid, Explorer 3, the
// terminal 5 — all invisible in `apps`.
const TOOL_DESCRIPTION =
  "List the desktop apps and WINDOWS currently open that you can target for desktop control. " +
  "`apps` gives each app's name (the title to pass to snapshot_app and the act tools) and its pid. " +
  "`windows` lists every open window separately — an app often has several (three Chrome windows, " +
  "two Explorer windows), so use it to see which one you mean and pass part of its title as " +
  "`window` to focus_window. READ-ONLY, and no permission is needed to look. Call this FIRST to " +
  "discover what to target — do not guess window titles, which are dynamic (e.g. " +
  '"*Notes.txt - Notepad"). To ACT on one of these, name it in a plan (propose_desktop_plan). ' +
  "Windows only today; returns an empty list on other platforms.";

/** One window as the model needs to see it.
 *
 *  The HWND is deliberately NOT exposed: it is meaningless to the model, dies
 *  with the window, and would invite it to be passed around as a target when
 *  every tool here addresses windows by app + title. */
export type ListedWindow = {
  app: string;
  title: string;
  minimized: boolean;
  maximized: boolean;
};

export function describeWindows(
  windows: readonly DesktopWindow[],
): ListedWindow[] {
  return windows.map((window) => ({
    app: window.appName,
    title: window.title,
    minimized: window.minimized,
    maximized: window.maximized,
  }));
}

export function buildListOpenAppsResponse(
  apps: OpenApp[],
  windows: readonly DesktopWindow[] = [],
): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { count: apps.length, apps, windows: describeWindows(windows) },
          null,
          2,
        ),
      },
    ],
  };
}

export type ListOpenAppsToolDeps = {
  /** Injectable so tests never load the capture binary. */
  listWindows?: () => DesktopWindow[];
};

/** Construct the read-only `list_open_apps` SDK MCP tool. */
export function makeListOpenAppsTool(deps: ListOpenAppsToolDeps = {}): unknown {
  const listWindows = deps.listWindows ?? listDesktopWindows;
  return (tool as unknown as McpToolFn)(
    "list_open_apps",
    TOOL_DESCRIPTION,
    {},
    async () => {
      try {
        const apps = await listOpenApps();
        // The window roster is ADDITIVE: if the capture source fails, the tool
        // still answers its original question rather than failing whole. This
        // tool is the one the instructions say to call first, so degrading it
        // to an error would strand the whole desktop flow.
        let windows: DesktopWindow[] = [];
        try {
          windows = listWindows();
        } catch {
          windows = [];
        }
        return buildListOpenAppsResponse(apps, windows);
      } catch (err) {
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
    { annotations: { readOnlyHint: true } },
  );
}
