import { describe, expect, it } from "vitest";
import { deriveSettledAgentActivity } from "./subagent-activity.js";

describe("deriveSettledAgentActivity", () => {
  it("returns null for an ordinary call (no persisted subagent fields)", () => {
    expect(
      deriveSettledAgentActivity({ status: "completed" }),
    ).toBeNull();
    expect(
      deriveSettledAgentActivity({
        status: "completed",
        subagentNarrative: null,
        subagentToolCalls: null,
      }),
    ).toBeNull();
    expect(
      deriveSettledAgentActivity({
        status: "completed",
        subagentNarrative: "",
        subagentToolCalls: [],
      }),
    ).toBeNull();
  });

  it("maps the persisted narrative + tool list to the pane's shape", () => {
    const activity = deriveSettledAgentActivity({
      status: "completed",
      subagentNarrative: "reading the file…",
      subagentToolCalls: [
        {
          toolUseId: "tu_1",
          toolName: "Read",
          toolInput: { file_path: "a.md" },
          status: "completed",
        },
        {
          toolUseId: "tu_2",
          toolName: "Bash",
          toolInput: { command: "ls" },
          status: "failed",
        },
      ],
    });
    expect(activity).toEqual({
      text: "reading the file…",
      toolCalls: [
        {
          toolUseId: "tu_1",
          toolName: "Read",
          toolInput: { file_path: "a.md" },
          status: "completed",
        },
        {
          toolUseId: "tu_2",
          toolName: "Bash",
          toolInput: { command: "ls" },
          status: "failed",
        },
      ],
    });
  });

  it("narrative alone is enough (an agent that used no tools)", () => {
    const activity = deriveSettledAgentActivity({
      status: "completed",
      subagentNarrative: "done — nothing to change.",
      subagentToolCalls: null,
    });
    expect(activity).toEqual({ text: "done — nothing to change.", toolCalls: [] });
  });

  it("a child stuck 'started' under a settled parent shows failed — never breathing", () => {
    const activity = deriveSettledAgentActivity({
      status: "cancelled",
      subagentNarrative: null,
      subagentToolCalls: [
        { toolUseId: "tu_1", toolName: "Read", toolInput: {}, status: "started" },
      ],
    });
    expect(activity?.toolCalls[0]?.status).toBe("failed");
  });

  it("a live parent keeps its running children live", () => {
    const activity = deriveSettledAgentActivity({
      status: "started",
      subagentNarrative: null,
      subagentToolCalls: [
        { toolUseId: "tu_1", toolName: "Read", toolInput: {}, status: "started" },
      ],
    });
    expect(activity?.toolCalls[0]?.status).toBe("started");
  });
});
