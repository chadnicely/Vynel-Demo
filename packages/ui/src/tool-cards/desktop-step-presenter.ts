// Presentation for the `mcp__desktop__*` tools — what a person should read
// while Claude touches their desktop. Two voices from one parse:
//   - `describeDesktopStep` — present-progressive, for the attention overlay
//     ("Pressing "Save" in Notepad");
//   - `presentDesktopToolCall` — the tool-card verb/argument branch, so the
//     main-window transcript reads the same action in card grammar.
// Pure functions; anything unparseable falls back to readable generics.

import { displayToolName, type ToolCallPresentation } from "./tool-presenters.js";

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

/**
 * The overlay's step label — present progressive, or null for a tool that
 * isn't a desktop tool (the caller keeps its own fallback).
 */
export function describeDesktopStep(toolName: string, toolInput: unknown): string | null {
  if (!toolName.startsWith(DESKTOP_TOOL_PREFIX)) return null;
  const shortName = toolName.slice(DESKTOP_TOOL_PREFIX.length);
  switch (shortName) {
    case "list_open_apps":
      return "Looking at your open apps";
    case "list_desktop_notifications":
      return "Checking your notifications";
    case "snapshot_app":
      return `Reading ${inputString(toolInput, "app") ?? "an app"}`;
    case "screenshot_app":
      return `Taking a look at ${inputString(toolInput, "app") ?? "an app"}`;
    case "act_on_app": {
      const action = inputString(toolInput, "action");
      const voice = action !== null ? ACTION_VOICES[action] : undefined;
      return `${voice?.progressive ?? "Acting on"} ${actTarget(toolInput)}`;
    }
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

/** A desktop plan parsed off the approval card's tool input — null when the
 *  input isn't plan-shaped (the card then falls back to its generic panes). */
export type DesktopPlanCard = {
  goal: string;
  steps: string[];
  apps: Array<{ app: string; tier: string }>;
};

/** ALL-OR-NOTHING by design: one malformed entry rejects the whole parse (→
 *  generic JSON panes), never a cleaned subset — the plan pane must show
 *  exactly what an approval can arm, structurally, not by trusting the server
 *  validator to have been stricter. */
export function parseDesktopPlanCard(toolInput: unknown): DesktopPlanCard | null {
  const goal = inputString(toolInput, "goal");
  if (goal === null) return null;
  const bag = toolInput as Record<string, unknown>;
  const rawSteps = bag["steps"];
  const rawApps = bag["apps"];
  if (!Array.isArray(rawSteps) || !Array.isArray(rawApps)) return null;
  if (rawSteps.length === 0 || rawApps.length === 0) return null;
  const steps: string[] = [];
  for (const step of rawSteps) {
    if (typeof step !== "string" || step.length === 0) return null;
    steps.push(step);
  }
  const apps: Array<{ app: string; tier: string }> = [];
  for (const entry of rawApps) {
    if (typeof entry !== "object" || entry === null) return null;
    const app = (entry as Record<string, unknown>)["app"];
    const tier = (entry as Record<string, unknown>)["tier"];
    if (typeof app !== "string" || app.length === 0 || typeof tier !== "string") return null;
    apps.push({ app, tier });
  }
  return { goal, steps, apps };
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
    case "act_on_desktop":
      return {
        verb: describeCoordAction(toolInput, "past"),
        argument: null,
        subtitle: "on your desktop",
        stats: null,
        body,
      };
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
