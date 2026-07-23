import { describe, expect, it } from "vitest";
import { shortcutHint } from "./shortcut-label.js";

describe("shortcutHint", () => {
  it("renders Mac glyphs on Mac", () => {
    expect(shortcutHint("N", {}, true)).toBe("⌘N");
    expect(shortcutHint("N", { shift: true }, true)).toBe("⌘⇧N");
    expect(shortcutHint(",", {}, true)).toBe("⌘,");
  });

  it("renders Ctrl+ words everywhere else", () => {
    expect(shortcutHint("N", {}, false)).toBe("Ctrl+N");
    expect(shortcutHint("N", { shift: true }, false)).toBe("Ctrl+Shift+N");
    expect(shortcutHint("K", {}, false)).toBe("Ctrl+K");
  });

  it("defaults to the detected platform (jsdom is not a Mac)", () => {
    expect(shortcutHint("K")).toBe("Ctrl+K");
  });
});
