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
    default:
      return displayToolName(toolName);
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
    default:
      return null;
  }
}
