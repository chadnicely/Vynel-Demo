import { describe, it, expect } from "vitest";
import { createDesktopPlanEnvelope } from "../plan/desktop-plan-envelope.js";
import { makeFocusWindowTool } from "./focus-window-tool.js";
import type { DesktopWindow } from "../a11y/desktop-windows.js";

type BuiltTool = {
  name: string;
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean };
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  }>;
};

function makeWindow(
  overrides: Partial<DesktopWindow> & { handle: number },
): DesktopWindow {
  return {
    pid: 100,
    appName: "Discord",
    title: "general - Discord",
    minimized: false,
    maximized: false,
    z: 100,
    ...overrides,
  };
}

const armed = (app = "Discord") => {
  const envelope = createDesktopPlanEnvelope("standing-consent");
  envelope.arm({ goal: "g", steps: ["s"], apps: [{ app, tier: "click" }] });
  return envelope;
};

function build(
  envelope = armed(),
  overrides: {
    windows?: DesktopWindow[];
    focus?: (handle: number) => Promise<boolean>;
    isRunning?: (query: string) => Promise<boolean>;
  } = {},
) {
  const focused: number[] = [];
  const tool = makeFocusWindowTool(envelope, {
    // Injected so these tests never load the capture binary — the
    // set_window_state precedent.
    listWindows: () => overrides.windows ?? [makeWindow({ handle: 7 })],
    focus:
      overrides.focus ??
      (async (handle: number) => {
        focused.push(handle);
        return true;
      }),
    isRunning: overrides.isRunning ?? (async () => false),
  }) as BuiltTool;
  return { tool, focused };
}

const textOf = (result: { content: Array<{ text?: string }> }): string =>
  result.content.map((part) => part.text ?? "").join("\n");

describe("makeFocusWindowTool", () => {
  it("is named focus_window and marked destructive (it changes the screen)", () => {
    const { tool } = build();
    expect(tool.name).toBe("focus_window");
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).not.toBe(true);
  });

  it("refuses without an armed plan — same gate as the act tools", async () => {
    const { tool, focused } = build(
      createDesktopPlanEnvelope("standing-consent"),
    );
    const result = await tool.handler({ app: "Discord" });
    expect(result.isError).toBe(true);
    expect(focused).toEqual([]);
  });

  it("raises the window and names it", async () => {
    const { tool, focused } = build();
    const result = await tool.handler({ app: "Discord" });
    expect(result.isError).not.toBe(true);
    expect(focused).toEqual([7]);
    expect(textOf(result)).toContain("general - Discord");
  });

  it("names the ALTERNATIVES when the app has several windows", async () => {
    // A wrong pick has to be recoverable in one retry — a bare "ok" would hide
    // the whole multi-window failure mode.
    const { tool, focused } = build(armed("Google Chrome"), {
      windows: [
        makeWindow({
          handle: 1,
          appName: "Google Chrome",
          title: "Docs - Chrome",
          z: 900,
        }),
        makeWindow({
          handle: 2,
          appName: "Google Chrome",
          title: "Mail - Chrome",
          z: 10,
        }),
      ],
    });
    const result = await tool.handler({ app: "Chrome" });
    expect(focused).toEqual([1]);
    const text = textOf(result);
    expect(text).toContain("Docs - Chrome");
    expect(text).toContain("Mail - Chrome");
    expect(text).toContain("2 windows");
  });

  it("honours a window title hint", async () => {
    const { tool, focused } = build(armed("Google Chrome"), {
      windows: [
        makeWindow({
          handle: 1,
          appName: "Google Chrome",
          title: "Docs - Chrome",
          z: 900,
        }),
        makeWindow({
          handle: 2,
          appName: "Google Chrome",
          title: "Mail - Chrome",
          z: 10,
        }),
      ],
    });
    await tool.handler({ app: "Chrome", window: "Mail" });
    expect(focused).toEqual([2]);
  });

  it("reports a hint that matches nothing WITHOUT falling back to another window", async () => {
    const { tool, focused } = build(armed("Google Chrome"), {
      windows: [
        makeWindow({
          handle: 1,
          appName: "Google Chrome",
          title: "Docs - Chrome",
        }),
      ],
    });
    const result = await tool.handler({ app: "Chrome", window: "Calendar" });
    expect(result.isError).toBe(true);
    expect(focused).toEqual([]);
    expect(textOf(result)).toContain("Calendar");
  });

  it("enforces against the RESOLVED app identity, never the fuzzy query", async () => {
    // The packaged-app hazard: "focus Calculator" must not authorize as
    // Calculator while raising a Settings window. The plan here covers only
    // Discord, so a Settings window must be refused.
    //
    // The denial surfaces as an isError RESULT, not a rejection: the handler
    // catches (like every act tool here) so the model gets an actionable
    // message instead of a thrown turn. What matters is that nothing was
    // raised.
    const { tool, focused } = build(armed("Discord"), {
      windows: [
        makeWindow({ handle: 3, appName: "Settings", title: "Settings" }),
      ],
    });
    const result = await tool.handler({ app: "Settings" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Settings");
    expect(focused).toEqual([]);
  });

  it("distinguishes a tray-hidden app from one that is not open", async () => {
    const trayed = build(armed(), { windows: [], isRunning: async () => true });
    expect(textOf(await trayed.tool.handler({ app: "Discord" }))).toContain(
      "system tray",
    );

    const absent = build(armed(), {
      windows: [],
      isRunning: async () => false,
    });
    expect(textOf(await absent.tool.handler({ app: "Discord" }))).toContain(
      "No open window",
    );
  });

  it("reports a REFUSED focus honestly instead of claiming success", async () => {
    // Two of the techniques Windows refuses return True, so a focus tool that
    // trusted a boolean would claim success while nothing moved.
    const { tool } = build(armed(), { focus: async () => false });
    const result = await tool.handler({ app: "Discord" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Could not bring");
  });

  it("requires an app", async () => {
    const { tool, focused } = build();
    const result = await tool.handler({ app: "   " });
    expect(result.isError).toBe(true);
    expect(focused).toEqual([]);
  });
});
