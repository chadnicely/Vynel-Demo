import { describe, it, expect } from "vitest";
import {
  compareWindowPreference,
  selectWindow,
  topWindowForPid,
  type DesktopWindow,
} from "./desktop-windows.js";

function makeWindow(
  overrides: Partial<DesktopWindow> & { handle: number },
): DesktopWindow {
  return {
    pid: 100,
    appName: "Google Chrome",
    title: "",
    minimized: false,
    maximized: false,
    z: 0,
    ...overrides,
  };
}

describe("compareWindowPreference", () => {
  it("puts an on-screen window ahead of a minimized one", () => {
    // Raising a window the user already has up is both the better guess AND
    // the less disruptive act.
    const onScreen = makeWindow({ handle: 1, z: 1 });
    const minimized = makeWindow({ handle: 2, z: 900, minimized: true });
    expect([minimized, onScreen].sort(compareWindowPreference)[0]).toBe(
      onScreen,
    );
  });

  it("prefers the higher z — the window most recently in front", () => {
    const front = makeWindow({ handle: 1, z: 900 });
    const back = makeWindow({ handle: 2, z: 10 });
    expect([back, front].sort(compareWindowPreference)[0]).toBe(front);
  });

  it("breaks a z tie on the longer title — helper windows carry short ones", () => {
    // The lesson selectWindowedPid already learned for Electron: an app spawns
    // stub windows, and "first enumerated" picked whichever came back first.
    const real = makeWindow({ handle: 2, title: "@user - Discord" });
    const stub = makeWindow({ handle: 1, title: "" });
    expect([stub, real].sort(compareWindowPreference)[0]).toBe(real);
  });

  it("is deterministic when everything else ties", () => {
    const a = makeWindow({ handle: 5, title: "same" });
    const b = makeWindow({ handle: 3, title: "same" });
    expect([a, b].sort(compareWindowPreference)[0]?.handle).toBe(3);
  });
});

describe("selectWindow", () => {
  const chromeFront = makeWindow({
    handle: 1,
    appName: "Google Chrome",
    title: "Docs - Chrome",
    z: 900,
  });
  const chromeBack = makeWindow({
    handle: 2,
    appName: "Google Chrome",
    title: "Mail - Chrome",
    z: 10,
  });
  const discord = makeWindow({
    handle: 3,
    appName: "Discord",
    title: "general - Discord",
    z: 500,
  });
  const all = [chromeBack, chromeFront, discord];

  it("picks the app's most recently used window and reports the rest", () => {
    const match = selectWindow(all, "Chrome");
    expect(match?.window).toBe(chromeFront);
    // The alternatives are what make a wrong pick recoverable in one retry.
    expect(match?.alternatives).toEqual([chromeBack]);
  });

  it("narrows to one window by title hint", () => {
    expect(selectWindow(all, "Chrome", "Mail")?.window).toBe(chromeBack);
  });

  it("treats a title hint that matches nothing as a MISS, not a fallback", () => {
    // Falling back to the whole pool would act on a window the caller
    // explicitly did not ask for.
    expect(selectWindow(all, "Chrome", "Calendar")).toBeNull();
  });

  it("ranks an app-NAME match above a window whose title merely contains the query", () => {
    // A Chrome tab titled "…discord…" must never outrank Discord itself.
    const chromeAboutDiscord = makeWindow({
      handle: 9,
      appName: "Google Chrome",
      title: "discord.com - Chrome",
      z: 999,
    });
    const match = selectWindow([chromeAboutDiscord, discord], "Discord");
    expect(match?.window).toBe(discord);
    expect(match?.alternatives).toEqual([]);
  });

  it("falls back to a title match when no app name matches", () => {
    expect(selectWindow(all, "Mail")?.window).toBe(chromeBack);
  });

  it("returns null for no match and for a blank query", () => {
    expect(selectWindow(all, "Photoshop")).toBeNull();
    // Blank must fail CLOSED: isAppNameMatch('') matches EVERYTHING, so an
    // empty query would otherwise raise an arbitrary window.
    expect(selectWindow(all, "   ")).toBeNull();
  });
});

describe("topWindowForPid", () => {
  it("picks the frontmost window a pid owns — the multi-window fix", () => {
    // This is what MainWindowHandle could not express: one handle per process,
    // so the second Chrome window was unaddressable.
    const front = makeWindow({ handle: 1, pid: 5488, z: 900 });
    const back = makeWindow({ handle: 2, pid: 5488, z: 5 });
    const other = makeWindow({ handle: 3, pid: 999, z: 999 });
    expect(topWindowForPid([back, other, front], 5488)).toBe(front);
  });

  it("is null when the pid owns no window (a tray-hidden app)", () => {
    expect(
      topWindowForPid([makeWindow({ handle: 1, pid: 1 })], 4242),
    ).toBeNull();
  });
});
