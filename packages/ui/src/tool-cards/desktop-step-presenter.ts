// Which `mcp__desktop__*` tool produced a step, and how it should read on each
// surface. Two voices over one vocabulary (`desktop-action-voices.ts`):
//   - `describeDesktopStep` — present-progressive, for the attention overlay
//     ("Pressing "Save" in Notepad");
//   - `presentDesktopToolCall` — the tool-card verb/argument branch, so the
//     main-window transcript reads the same action in card grammar.
// Pure functions; anything unparseable falls back to readable generics.

import { displayToolName, type ToolCallPresentation } from "./tool-presenters.js";
import { parseDesktopPlanCard } from "./desktop-plan-card.js";
import {
  ACTION_VOICES,
  actTarget,
  batchedActions,
  describeBatch,
  describeCoordAction,
  describeElementAction,
  inputString,
  windowStatePast,
  windowStateProgressive,
} from "./desktop-action-voices.js";

export const DESKTOP_TOOL_PREFIX = "mcp__desktop__";

/**
 * The overlay's step label — present progressive, or null for a tool that
 * isn't a desktop tool (the caller keeps its own fallback).
 */
export function describeDesktopStep(toolName: string, toolInput: unknown): string | null {
  if (!toolName.startsWith(DESKTOP_TOOL_PREFIX)) return null;
  const shortName = toolName.slice(DESKTOP_TOOL_PREFIX.length);
  const actions = batchedActions(toolInput);
  if (actions !== null && (shortName === "act_on_app" || shortName === "act_on_desktop")) {
    return describeBatch(actions, inputString(toolInput, "app"), (action) =>
      shortName === "act_on_app"
        ? describeElementAction(action)
        : describeCoordAction(action, "progressive"),
    );
  }
  switch (shortName) {
    case "list_open_apps":
      return "Looking at your open apps";
    case "list_installed_apps":
      return "Looking for an app on your computer";
    case "launch_app":
      return `Opening ${inputString(toolInput, "app") ?? "an app"}`;
    case "set_window_state":
      return `${windowStateProgressive(inputString(toolInput, "state"))} ${inputString(toolInput, "app") ?? "a window"}`;
    case "list_desktop_notifications":
      return "Checking your notifications";
    case "list_monitors":
      return "Checking your screens";
    // Deliberately plain about the clipboard: it is shared by the whole
    // computer and may hold something private, so the user should see it named
    // rather than folded into a vaguer "reading".
    case "read_clipboard":
      return "Reading your clipboard";
    case "write_clipboard":
      return "Copying text to your clipboard";
    case "snapshot_app":
      return `Reading ${inputString(toolInput, "app") ?? "an app"}`;
    case "screenshot_app":
      return `Taking a look at ${inputString(toolInput, "app") ?? "an app"}`;
    case "act_on_app":
      return describeElementAction(toolInput);
    case "act_on_desktop":
      return describeCoordAction(toolInput, "progressive");
    case "propose_desktop_plan": {
      const goal = inputString(toolInput, "goal");
      return goal !== null ? `Proposing a plan: ${goal}` : "Proposing a plan";
    }
    case "request_desktop_access": {
      const app = inputString(toolInput, "app") ?? "an app";
      const tier = inputString(toolInput, "tier");
      return `Asking to use ${app}${tier !== null ? ` (${tierDisplay(tier)})` : ""}`;
    }
    default:
      return displayToolName(toolName);
  }
}

/** The tier in words a non-technical person reads on the card. */
export function tierDisplay(tier: string): string {
  switch (tier) {
    case "read":
      return "look only";
    case "click":
      return "look + click";
    case "full":
      return "look, click + type";
    default:
      return tier;
  }
}

/** The tool-card branch — desktop calls read as actions, never payload dumps. */
export function presentDesktopToolCall(
  toolName: string,
  toolInput: unknown,
  toolOutput: unknown,
): ToolCallPresentation | null {
  if (!toolName.startsWith(DESKTOP_TOOL_PREFIX)) return null;
  const shortName = toolName.slice(DESKTOP_TOOL_PREFIX.length);
  // Both null AND undefined render as empty — stringifying either would put a
  // literal "null"/"undefined" in the card body.
  const outputText =
    typeof toolOutput === "string"
      ? toolOutput
      : toolOutput === null || toolOutput === undefined
        ? ""
        : JSON.stringify(toolOutput, null, 2);
  const body = { kind: "text" as const, text: outputText };
  switch (shortName) {
    case "list_open_apps":
      return { verb: "Looked at open apps", argument: null, subtitle: null, stats: null, body };
    case "list_monitors":
      return { verb: "Checked your screens", argument: null, subtitle: null, stats: null, body };
    case "read_clipboard":
      // The clipboard's CONTENTS are the body, which is the point of the card:
      // if something private was read, the user can see exactly what.
      return {
        verb: "Read your clipboard",
        argument: null,
        subtitle: "shared by the whole computer",
        stats: null,
        body,
      };
    case "write_clipboard":
      return {
        verb: "Copied text to your clipboard",
        argument: null,
        subtitle: "replacing what was there",
        stats: null,
        body,
      };
    case "list_installed_apps":
      return {
        verb: "Looked for an app",
        argument: inputString(toolInput, "query"),
        subtitle: "installed on your computer",
        stats: null,
        body,
      };
    case "launch_app":
      return {
        verb: "Opened",
        argument: inputString(toolInput, "app"),
        subtitle: "on your desktop",
        stats: null,
        body,
      };
    case "set_window_state":
      return {
        verb: windowStatePast(inputString(toolInput, "state")),
        argument: inputString(toolInput, "app"),
        subtitle: "on your desktop",
        stats: null,
        body,
      };
    case "list_desktop_notifications":
      return { verb: "Checked notifications", argument: null, subtitle: null, stats: null, body };
    case "snapshot_app":
      return {
        verb: "Read",
        argument: inputString(toolInput, "app"),
        subtitle: "on your desktop",
        stats: null,
        body,
      };
    case "screenshot_app":
      return {
        verb: "Screenshotted",
        argument: inputString(toolInput, "app"),
        subtitle: "on your desktop",
        stats: null,
        body,
      };
    case "act_on_app": {
      const batch = batchedActions(toolInput);
      if (batch !== null) {
        return {
          verb: `Ran ${batch.length} action${batch.length === 1 ? "" : "s"}`,
          argument: inputString(toolInput, "app"),
          subtitle: "on your desktop",
          stats: null,
          body,
        };
      }
      const action = inputString(toolInput, "action");
      const voice = action !== null ? ACTION_VOICES[action] : undefined;
      return {
        verb: voice?.past ?? "Acted on",
        argument: actTarget(toolInput),
        subtitle: inputString(toolInput, "selector"),
        stats: null,
        body,
      };
    }
    case "act_on_desktop": {
      const batch = batchedActions(toolInput);
      return {
        verb:
          batch !== null
            ? `Ran ${batch.length} action${batch.length === 1 ? "" : "s"}`
            : describeCoordAction(toolInput, "past"),
        argument: batch !== null ? inputString(toolInput, "app") : null,
        subtitle: "on your desktop",
        stats: null,
        body,
      };
    }
    case "propose_desktop_plan": {
      const plan = parseDesktopPlanCard(toolInput);
      return {
        verb: "Proposed a plan",
        argument: inputString(toolInput, "goal"),
        subtitle: plan !== null ? `${plan.steps.length} steps` : null,
        stats: null,
        body,
      };
    }
    case "request_desktop_access": {
      const tier = inputString(toolInput, "tier");
      return {
        verb: "Asked to use",
        argument: inputString(toolInput, "app"),
        subtitle: tier !== null ? tierDisplay(tier) : null,
        stats: null,
        body,
      };
    }
    default:
      return null;
  }
}
