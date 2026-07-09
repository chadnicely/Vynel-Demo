import { describe, expect, it } from "vitest";
import { workspaceMonogram } from "./workspace-monogram.js";

describe("workspaceMonogram", () => {
  it("takes the first two letters of a one-word name", () => {
    expect(workspaceMonogram("vynel")).toBe("VY");
    expect(workspaceMonogram("blog")).toBe("BL");
  });

  it("takes the word initials of a multi-word name", () => {
    expect(workspaceMonogram("Marketing site")).toBe("MS");
    expect(workspaceMonogram("  my  side project ")).toBe("MS");
  });

  it("degrades gracefully on tiny or empty names", () => {
    expect(workspaceMonogram("x")).toBe("X");
    expect(workspaceMonogram("   ")).toBe("?");
  });
});
