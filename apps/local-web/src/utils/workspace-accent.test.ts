import { describe, expect, it } from "vitest";
import { workspaceColorSlot } from "@vynel/ui";
import { personaAccentCss, workspaceAccentCss } from "./workspace-accent.js";

describe("workspaceAccentCss", () => {
  it("prefers the hand-picked hex, then the chosen slot, then the name's own slot", () => {
    expect(workspaceAccentCss({ colorSlot: 3, customColor: "#1e90ff" }, "Acme")).toBe("#1e90ff");
    expect(workspaceAccentCss({ colorSlot: 3, customColor: null }, "Acme")).toBe("var(--ws-3)");
    expect(workspaceAccentCss({ colorSlot: null, customColor: null }, "Acme")).toBe(
      `var(--ws-${workspaceColorSlot("Acme")})`,
    );
    expect(workspaceAccentCss(null, "Acme")).toBe(`var(--ws-${workspaceColorSlot("Acme")})`);
  });

  it("the persona colour is its own pick, else it follows the workspace accent", () => {
    const base = { colorSlot: 3, customColor: null, personaColorSlot: null, personaCustomColor: null };
    expect(personaAccentCss(base, "Acme")).toBe("var(--ws-3)");
    expect(personaAccentCss({ ...base, personaColorSlot: 5 }, "Acme")).toBe("var(--ws-5)");
    expect(personaAccentCss({ ...base, personaCustomColor: "#abcdef" }, "Acme")).toBe("#abcdef");
    expect(personaAccentCss(null, "Acme")).toBe(workspaceAccentCss(null, "Acme"));
  });
});
