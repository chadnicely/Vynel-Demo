import { describe, expect, it } from "vitest";
import { splitSourceLabel } from "./source-label.js";

describe("splitSourceLabel", () => {
  it("takes the LAST separator segment as the workspace — persona-first, dots in names survive", () => {
    expect(splitSourceLabel("James · Claw Launcher")).toEqual({
      persona: "James",
      workspace: "Claw Launcher",
    });
    // A persona whose name itself carries the separator: last segment wins.
    expect(splitSourceLabel("J · R · Acme")).toEqual({
      persona: "J · R",
      workspace: "Acme",
    });
  });

  it("a bare persona (global colleague) has no workspace", () => {
    expect(splitSourceLabel("Nova")).toEqual({ persona: "Nova", workspace: null });
  });
});
