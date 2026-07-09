import { describe, expect, it } from "vitest";
import { workspaceAccentVar, workspaceColorSlot } from "./workspace-color.js";

describe("workspace-color", () => {
  it("is stable for the same name", () => {
    expect(workspaceColorSlot("Vynel")).toBe(workspaceColorSlot("Vynel"));
    expect(workspaceAccentVar("Bookkeeping")).toBe(
      workspaceAccentVar("Bookkeeping"),
    );
  });

  it("resolves the persona-first report label and the bare banner name to one color", () => {
    // `sourceLabel` is "<manager> · <workspace>" (@vynel/chat's
    // composeManagerSourceLabel), so the workspace name is the LAST segment.
    // The banner sees the bare "vynel"; the report row sees "Noah · vynel" —
    // both must land on the same slot.
    expect(workspaceColorSlot("Noah · vynel")).toBe(workspaceColorSlot("vynel"));
    expect(workspaceColorSlot("  vynel ")).toBe(workspaceColorSlot("Vynel"));
  });

  it("returns a --ws-* token reference within the palette range", () => {
    for (const name of ["a", "vynel", "Marketing site", "Bookkeeping", "Ops"]) {
      expect(workspaceAccentVar(name)).toMatch(/^var\(--ws-[1-6]\)$/);
    }
  });

  it("spreads distinct names across more than one slot", () => {
    const names = [
      "vynel",
      "bookkeeping",
      "marketing",
      "operations",
      "research",
      "sales",
      "support",
      "legal",
    ];
    const slots = new Set(names.map(workspaceColorSlot));
    expect(slots.size).toBeGreaterThan(1);
  });
});
