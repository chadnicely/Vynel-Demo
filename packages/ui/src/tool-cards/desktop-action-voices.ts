// How ONE desktop action reads in words — the vocabulary layer under
// `desktop-step-presenter.ts`. Split out because it is a distinct concern from
// tool-to-presentation mapping: this file answers "what do we call this
// action?", the presenter answers "which tool produced it?".
//
// Every verb comes in two tenses — the overlay narrates in the progressive
// ("Clicking at…") while the settled tool card reads in the past ("Clicked
// at…") — so the two surfaces can never drift apart in wording.
// Pure functions; anything unparseable falls back to readable generics.

export function inputString(input: unknown, field: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function inputNumber(input: unknown, field: string): number | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

// Describe an act_on_desktop coordinate action. `tense` picks the overlay's
// progressive voice ("Clicking") vs the settled card's past voice ("Clicked").
export function describeCoordAction(
  toolInput: unknown,
  tense: "progressive" | "past",
): string {
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

export const ACTION_VOICES: Record<string, DesktopActionVoice> = {
  press: { progressive: "Pressing", past: "Pressed" },
  type_text: { progressive: "Typing into", past: "Typed into" },
  set_value: { progressive: "Setting", past: "Set" },
};

export function actTarget(toolInput: unknown): string {
  const app = inputString(toolInput, "app") ?? "an app";
  const selector = inputString(toolInput, "selector");
  const elementName = selector !== null ? selectorDisplayName(selector) : null;
  if (elementName !== null) return `"${elementName}" in ${app}`;
  if (selector !== null) return `${selector} in ${app}`;
  return app;
}

/** One element-addressed action in the overlay's progressive voice — shared by
 *  the single act_on_app call and each step of a batched one. */
export function describeElementAction(toolInput: unknown): string {
  const action = inputString(toolInput, "action");
  const voice = action !== null ? ACTION_VOICES[action] : undefined;
  return `${voice?.progressive ?? "Acting on"} ${actTarget(toolInput)}`;
}

/** The `actions` array of a batched act call — null when the call is the
 *  single form (or the array is unusable). */
export function batchedActions(toolInput: unknown): Array<Record<string, unknown>> | null {
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

/** "Pressing X" → "pressing X" — the tail of a joined sentence. */
function lowerFirst(text: string): string {
  return text.length > 0 ? `${text[0]?.toLowerCase() ?? ""}${text.slice(1)}` : text;
}

/** A batch reads as ONE step, but must still NAME its ending: the irreversible
 *  action of a sequence is nearly always the last one ("…then Send"), and the
 *  overlay is the only live surface the user watches — a bare "+2 more" would
 *  hide exactly the step that matters most. First → last, with the count of
 *  what sits between them. `app` comes from the CALL (the server ignores any
 *  step-level app), so each action is described against the call's app only. */
export function describeBatch(
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

/** Window-state verbs, for the two voices of the set_window_state step. */
export function windowStateProgressive(state: string | null): string {
  switch (state) {
    case "maximized":
      return "Maximizing";
    case "minimized":
      return "Minimizing";
    case "restored":
      return "Restoring";
    default:
      return "Arranging";
  }
}

export function windowStatePast(state: string | null): string {
  switch (state) {
    case "maximized":
      return "Maximized";
    case "minimized":
      return "Minimized";
    case "restored":
      return "Restored";
    default:
      return "Arranged";
  }
}
