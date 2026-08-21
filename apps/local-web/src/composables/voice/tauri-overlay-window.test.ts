import { describe, expect, it } from "vitest";
import { overlayPosition } from "./tauri-overlay-window.js";

const SCREEN = { width: 1920, height: 1040 };

// The desktop-control overlay's own footprint (src-tauri/windows.rs) — what
// the mini dock stacks above.
const DESKTOP_CONTROL_HEIGHT = 360;

describe("overlayPosition", () => {
  it("centers for the dock's wake park", () => {
    expect(
      overlayPosition({ park: "center", width: 420, height: 560 }, SCREEN),
    ).toEqual({ x: 750, y: 240 });
  });

  it("parks bottom-right with a margin for the desktop-control overlay", () => {
    expect(
      overlayPosition({ park: "bottom-right", width: 380, height: 360 }, SCREEN),
    ).toEqual({ x: 1920 - 380 - 16, y: 1040 - 360 - 16 });
  });

  it("parks the mini dock in the corner when nothing is under it", () => {
    expect(
      overlayPosition({ park: "bottom-right", width: 380, height: 150 }, SCREEN),
    ).toEqual({ x: 1524, y: 874 });
  });

  it("lifts the mini dock clear of the window it stacks above", () => {
    expect(
      overlayPosition(
        {
          park: "bottom-right",
          width: 380,
          height: 150,
          stackAbove: { heightPx: DESKTOP_CONTROL_HEIGHT },
        },
        SCREEN,
      ),
      // The corner spot, minus that window's height and one more gap: 874 - 376.
    ).toEqual({ x: 1524, y: 498 });
  });

  // Nothing sits under a centered window — a stack offset there would drift it
  // off the middle for no reason anyone could see.
  it("ignores the stack offset in the middle of the screen", () => {
    expect(
      overlayPosition(
        { park: "center", width: 420, height: 560, stackAbove: { heightPx: 360 } },
        SCREEN,
      ),
    ).toEqual({ x: 750, y: 240 });
  });

  it("never goes negative on a small screen", () => {
    const tiny = { width: 300, height: 200 };
    expect(overlayPosition({ park: "center", width: 420, height: 560 }, tiny)).toEqual({
      x: 0,
      y: 0,
    });
    expect(
      overlayPosition({ park: "bottom-right", width: 420, height: 560 }, tiny),
    ).toEqual({ x: 0, y: 0 });
    expect(
      overlayPosition(
        { park: "bottom-right", width: 380, height: 150, stackAbove: { heightPx: 360 } },
        tiny,
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});
