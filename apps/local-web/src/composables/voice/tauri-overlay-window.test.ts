import { describe, expect, it } from "vitest";
import { overlayPosition } from "./tauri-overlay-window.js";

const SCREEN = { width: 1920, height: 1040 };

describe("overlayPosition", () => {
  it("centers for the dock park", () => {
    expect(overlayPosition("center", { width: 420, height: 560 }, SCREEN)).toEqual({
      x: 750,
      y: 240,
    });
  });

  it("parks bottom-right with a margin for the desktop-control overlay", () => {
    expect(overlayPosition("bottom-right", { width: 380, height: 360 }, SCREEN)).toEqual({
      x: 1920 - 380 - 16,
      y: 1040 - 360 - 16,
    });
  });

  it("never goes negative on a small screen", () => {
    const tiny = { width: 300, height: 200 };
    expect(overlayPosition("center", { width: 420, height: 560 }, tiny)).toEqual({ x: 0, y: 0 });
    expect(overlayPosition("bottom-right", { width: 420, height: 560 }, tiny)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
