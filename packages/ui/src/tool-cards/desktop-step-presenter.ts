// Presentation for the `mcp__desktop__*` tools — what a person should read
// while Claude touches their desktop. Two voices from one parse:
//   - `describeDesktopStep` — present-progressive, for the attention overlay
//     ("Pressing "Save" in Notepad");
//   - `presentDesktopToolCall` — the tool-card verb/argument branch, so the
//     main-window transcript reads the same action in card grammar.
// Pure functions; anything unparseable falls back to readable generics.

import { displayToolName, type ToolCallPresentation } from "./tool-presenters.js";
import { parseDesktopPlanCard } from "./desktop-plan-card.js";

export const DESKTOP_TOOL_PREFIX = "mcp__desktop__";

function inputString(input: unknown, field: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function inputNumber(input: unknown, field: string): number | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

// Describe an act_on_desktop coordinate action. `tense` picks the overlay's
// progressive voice ("Clicking") vs the settled card's past voice ("Clicked").
function describeCoordAction(toolInput: unknown, tense: "progressive" | "past"): string {
  const action = inputString(toolInput, "action");
  const x = inputNumber(toolInput, "x");
  const y = inputNumber(toolInput, "y");
  const at = x !== null && y !== null ? ` at (${x}, ${y})` : "";
  const inApp = inputString(toolInput, "app");
  const where = inApp !== null ? ` in ${inApp}` : "";
  const p = tense === "progressive";
  switch (action) {
    case "click": {
      const isDouble = (toolInput as Record<string, unknown>)?.["double"] === true;
      const verb = isDouble ? (p ? "Double-clicking" : "Double-clicked") : p ? "Clicking" : "Clicked";
      return `${verb}${at}${where}`;
    }
    case "type":
      return `${p ? "Typing" : "Typed"} "${inputString(toolInput, "text") ?? ""}"${where}`;
    case "press":
      return `${p ? "Pressing" : "Pressed"} ${inputString(toolInput, "keys") ?? "a key"}`;
    case "scroll":
      return `${p ? "Scrolling" : "Scrolled"} ${inputString(toolInput, "direction") ?? "down"}${at}${where}`;
    case "drag": {
      const toX = inputNumber(toolInput, "toX");
      const toY = inputNumber(toolInput, "toY");
      const target = toX !== null && toY !== null ? ` to (${toX}, ${toY})` : "";
      return `${p ? "Dragging" : "Dragged"}${at}${target}${where}`;
    }
    default:
      return p ? "Controlling the desktop" : "Controlled the desktop";
  }
}

/** Pull the human name out of a selector — `button[name="Save"]` → "Save",
 *  `[stable_id="…"]` → null (ids aren't names). */
export function selectorDisplayName(selector: string): string | null {
  const nameMatch = selector.match(/\[name="([^"]+)"\]/);
  return nameMatch?.[1] ?? null;
}

type DesktopActionVoice = { progressive: string; past: string };

const ACTION_VOICES: Record<string, DesktopActionVoice> = {
  press: { progressive: "Pressing", past: "Pressed" },
  type_text: { progressive: "Typing into", past: "Typed into" },
  set_value: { progressive: "Setting", past: "Set" },
};

function actTarget(toolInput: unknown): string {
  const app = inputString(toolInput, "app") ?? "an app";
  const selector = inputString(toolInput, "selector");
  const elementName = selector !== null ? selectorDisplayName(selector) : null;
  if (elementName !== null) return `"${elementName}" in ${app}`;
  if (selector !== null) return `${selector} in ${app}`;
  return app;
}

/** One element-addressed action in the overlay's progressive voice — shared by
 *  the single act_on_app call and each step of a batched one. */
function describeElementAction(toolInput: unknown): string {
  const action = inputString(toolInput, "action");
  const voice = action !== null ? ACTION_VOICES[action] : undefined;
  return `${voice?.progressive ?? "Acting on"} ${actTarget(toolInput)}`;
}

/** The `actions` array of a batched act call — null when the call is the
 *  single form (or the array is unusable). */
function batchedActions(toolInput: unknown): Array<Record<string, unknown>> | null {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const actions = (toolInput as Record<string, unknown>)["actions"];
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const entries = actions.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null,
  );
  // An all-junk array is NOT a batch — the server rejects those calls, and
  // reporting "Ran 0 actions" would be a worse lie than the generic fallback.
  return entries.length > 0 ? entries : null;
}

/** A batch reads as ONE step, but must still NAME its ending: the irreversible
 *  action of a sequence is nearly always the last one ("…then Send"), and the
 *  overlay is the only live surface the user watches — a bare "+2 more" would
 *  hide exactly the step that matters most. First → last, with the count of
 *  what sits between them. `app` comes from the CALL (the server ignores any
 *  step-level app), so each action is described against the call's app only. */
function describeBatch(
  actions: Array<Record<string, unknown>>,
  app: string | null,
  describeOne: (action: Record<string, unknown>) => string,
): string {
  const withCallApp = (action: Record<string, unknown>) =>
    describeOne({ ...action, app: app ?? undefined });
  const first = actions[0];
  if (first === undefined) return "Acting on your desktop";
  const label = withCallApp(first);
  if (actions.length === 1) return label;
  const last = actions[actions.length - 1];
  const between = actions.length - 2;
  const tail = last !== undefined ? withCallApp(last) : "";
  return between > 0
    ? `${label}, +${between} more, then ${lowerFirst(tail)}`
    : `${label}, then ${lowerFirst(tail)}`;
}

/** "Pressing X" → "pressing X" — the tail of a joined sentence. */
function lowerFirst(text: string): string {
  return text.length > 0 ? `${text[0]?.toLowerCase() ?? ""}${text.slice(1)}` : text;
}

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
    case "list_desktop_notifications":
      return "Checking your notifications";
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
  const outputText =
    typeof toolOutput === "string" ? toolOutput : toolOutput == null ? "" : JSON.stringify(toolOutput, null, 2);
  const body = { kind: "text" as const, text: outputText };
  switch (shortName) {
    case "list_open_apps":
      return { verb: "Looked at open apps", argument: null, subtitle: null, stats: null, body };
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
