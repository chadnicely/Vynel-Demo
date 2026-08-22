import { describe, it, expect } from "vitest";
import {
  buildListOpenAppsResponse,
  describeWindows,
} from "./list-open-apps-tool.js";
import type { OpenApp } from "../a11y/xa11y-adapter.js";
import type { DesktopWindow } from "../a11y/desktop-windows.js";

const parse = (
  apps: OpenApp[],
  windows: DesktopWindow[] = [],
): {
  count: number;
  apps: OpenApp[];
  windows: Array<{ app: string; title: string }>;
} =>
  JSON.parse(buildListOpenAppsResponse(apps, windows).content[0]?.text ?? "");

function makeWindow(
  overrides: Partial<DesktopWindow> & { handle: number },
): DesktopWindow {
  return {
    pid: 5488,
    appName: "Google Chrome",
    title: "Docs - Chrome",
    minimized: false,
    maximized: false,
    z: 100,
    ...overrides,
  };
}

describe("buildListOpenAppsResponse", () => {
  it("returns the count and apps as JSON text", () => {
    const parsed = parse([
      { name: "Calculator", pid: 7228 },
      { name: "YouTube - Google Chrome", pid: 111 },
    ]);
    expect(parsed.count).toBe(2);
    expect(parsed.apps.map((app) => app.name)).toEqual([
      "Calculator",
      "YouTube - Google Chrome",
    ]);
  });

  it("reports no open apps as count 0", () => {
    expect(parse([]).count).toBe(0);
  });

  it("lists an app's windows SEPARATELY — what `apps` cannot express", () => {
    // Measured 2026-08-22: Chrome ran three windows on one pid. The `apps`
    // roster collapses them, so the model could not name the one it meant.
    const parsed = parse(
      [{ name: "Docs - Chrome", pid: 5488 }],
      [
        makeWindow({ handle: 1, title: "Docs - Chrome" }),
        makeWindow({ handle: 2, title: "Mail - Chrome" }),
        makeWindow({ handle: 3, title: "Incognito - Chrome", minimized: true }),
      ],
    );
    expect(parsed.apps).toHaveLength(1);
    expect(parsed.windows.map((window) => window.title)).toEqual([
      "Docs - Chrome",
      "Mail - Chrome",
      "Incognito - Chrome",
    ]);
  });
});

describe("describeWindows", () => {
  it("reports the state a caller needs and NOT the raw handle", () => {
    // The HWND is meaningless to the model, dies with the window, and would
    // invite being passed as a target — every tool addresses app + title.
    const [described] = describeWindows([
      makeWindow({ handle: 99, minimized: true, maximized: true }),
    ]);
    expect(described).toEqual({
      app: "Google Chrome",
      title: "Docs - Chrome",
      minimized: true,
      maximized: true,
    });
    expect(JSON.stringify(described)).not.toContain("99");
  });
});
