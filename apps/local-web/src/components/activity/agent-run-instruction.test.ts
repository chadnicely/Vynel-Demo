import { describe, expect, it } from "vitest";
import { agentRunInstruction, agentRunResultText } from "./agent-run-instruction.js";

describe("agentRunInstruction", () => {
  it("reads the description, agent kind, and brief off the spawning call's input", () => {
    expect(
      agentRunInstruction({
        description: " Whoami check ",
        subagent_type: "Explore",
        prompt: "Find who owns the login page.",
      }),
    ).toEqual({
      description: "Whoami check",
      agentType: "Explore",
      prompt: "Find who owns the login page.",
    });
  });

  it("falls back to `name` for the agent kind and tolerates a bare prompt", () => {
    expect(agentRunInstruction({ name: "researcher", prompt: "Go." })).toEqual({
      description: null,
      agentType: "researcher",
      prompt: "Go.",
    });
  });

  it("is null for an unreadable or empty input", () => {
    expect(agentRunInstruction(null)).toBeNull();
    expect(agentRunInstruction("prompt text")).toBeNull();
    expect(agentRunInstruction({ description: "   " })).toBeNull();
  });
});

describe("agentRunResultText", () => {
  it("passes a string report through and unwraps SDK text blocks", () => {
    expect(agentRunResultText("All green.")).toBe("All green.");
    expect(
      agentRunResultText([
        { type: "text", text: "Part one." },
        { type: "image", data: "…" },
        { type: "text", text: "Part two." },
      ]),
    ).toBe("Part one.\n\nPart two.");
  });

  it("serializes anything else and is null when there is nothing to show", () => {
    expect(agentRunResultText({ ok: true })).toBe('{\n  "ok": true\n}');
    expect(agentRunResultText(null)).toBeNull();
    expect(agentRunResultText("   ")).toBeNull();
  });
});
