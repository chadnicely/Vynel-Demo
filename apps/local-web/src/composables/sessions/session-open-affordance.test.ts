// The direct-send rule's one home (B6 + redesign D7): spawned sessions AND
// agent colleagues chat directly; everything else carries on in its own chat.

import { describe, expect, it } from "vitest";
import { sessionOpenAffordance } from "./session-open-affordance.js";

describe("sessionOpenAffordance", () => {
  it("a spawned chain head chats directly — no note", () => {
    expect(sessionOpenAffordance("spawned")).toEqual({
      chattable: true,
      viewOnlyNote: null,
    });
  });

  // test: correct expectation — G5 shipped (redesign D7): colleague direct-send
  // composes the delegated agent-session set, same semantics as a mention.
  it("an agent colleague chats directly too (G5)", () => {
    expect(sessionOpenAffordance("agent")).toEqual({
      chattable: true,
      viewOnlyNote: null,
    });
  });

  it("primaries are view-only — the conversation lives in its own chat", () => {
    for (const scope of ["global", "workspace"] as const) {
      const affordance = sessionOpenAffordance(scope);
      expect(affordance.chattable).toBe(false);
      expect(affordance.viewOnlyNote).toContain("its own chat");
    }
  });
});
