import { describe, expect, it } from "vitest";
import { workspaceColorSlot } from "@vynel/ui";
import { workspaceAccentCss } from "./workspace-accent.js";

describe("workspaceAccentCss", () => {
  it("prefers the hand-picked hex, then the chosen slot, then the name's own slot", () => {
    expect(workspaceAccentCss({ colorSlot: 3, customColor: "#1e90ff" }, "Acme")).toBe("#1e90ff");
    expect(workspaceAccentCss({ colorSlot: 3, customColor: null }, "Acme")).toBe("var(--ws-3)");
    expect(workspaceAccentCss({ colorSlot: null, customColor: null }, "Acme")).toBe(
      `var(--ws-${workspaceColorSlot("Acme")})`,
    );
    expect(workspaceAccentCss(null, "Acme")).toBe(`var(--ws-${workspaceColorSlot("Acme")})`);
  });
});
