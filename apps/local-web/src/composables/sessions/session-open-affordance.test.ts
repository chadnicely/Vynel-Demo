// The direct-send rule's one home (B6): spawned chats, a colleague points at
// @mention, everything else carries on in its own chat.

import { describe, expect, it } from "vitest";
import { sessionOpenAffordance } from "./session-open-affordance.js";

describe("sessionOpenAffordance", () => {
  it("a spawned chain head chats directly — no note", () => {
    expect(sessionOpenAffordance("spawned")).toEqual({
      chattable: true,
      viewOnlyNote: null,
    });
  });

  it("an agent colleague is view-only and points at @mention", () => {
    const affordance = sessionOpenAffordance("agent");
    expect(affordance.chattable).toBe(false);
    expect(affordance.viewOnlyNote).toContain("@mention");
  });

  it("primaries are view-only — the conversation lives in its own chat", () => {
    for (const scope of ["global", "workspace"] as const) {
      const affordance = sessionOpenAffordance(scope);
      expect(affordance.chattable).toBe(false);
      expect(affordance.viewOnlyNote).toContain("its own chat");
    }
  });
});
