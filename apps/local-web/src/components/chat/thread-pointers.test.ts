import { describe, it, expect } from "vitest";
import {
  buildAgentRunPointer,
  buildThreadPointers,
  buildToolCallPointer,
  isAgentSpawnToolCall,
} from "./thread-pointers.js";

describe("buildThreadPointers", () => {
  it("maps in-flight rows by trace key with persona-first target labels", () => {
    const pointers = buildThreadPointers([
      {
        partialSessionId: "trace-1",
        status: "claimed",
        taskLabel: "July invoicing",
        workspaceName: "Invoices",
        sessionName: "July run",
        targetSessionId: "seg-9",
        workspaceId: null,
      },
      {
        partialSessionId: "trace-2",
        status: "pending",
        taskLabel: "Chase POs",
        workspaceName: "Invoices",
        sessionName: null,
        workspaceId: "ws-1",
      },
      // Keyless job — no anchor to point at.
      { partialSessionId: null, status: "pending", taskLabel: "ghost" },
    ]);

    expect(pointers.size).toBe(2);
    expect(pointers.get("trace-1")).toEqual({
      partialSessionId: "trace-1",
      taskLabel: "July invoicing",
      targetLabel: "July run · Invoices",
      status: "working",
      targetSessionId: "seg-9",
      workspaceId: null,
    });
    expect(pointers.get("trace-2")).toEqual({
      partialSessionId: "trace-2",
      taskLabel: "Chase POs",
      targetLabel: "Invoices",
      status: "queued",
      targetSessionId: null,
      workspaceId: "ws-1",
    });
  });

  it("never doubles the label when the session name IS the workspace name, and falls back on empties", () => {
    const pointers = buildThreadPointers([
      {
        partialSessionId: "trace-3",
        status: "claimed",
        taskLabel: "  ",
        workspaceName: "Acme",
        sessionName: "Acme",
      },
      { partialSessionId: "trace-4", status: "pending" },
    ]);

    expect(pointers.get("trace-3")).toEqual({
      partialSessionId: "trace-3",
      taskLabel: "Task",
      targetLabel: "Acme",
      status: "working",
      targetSessionId: null,
      workspaceId: null,
    });
    expect(pointers.get("trace-4")!.targetLabel).toBe("Session");
  });
});

// The PERSISTENT builder (Chad, 2026-08-09 — pointers stay after completion):
// built from the dispatch tool call's served delegation payload, so a settled
// task keeps its pointer in its terminal state.
describe("buildToolCallPointer", () => {
  it("maps every job status onto the pointer state, keeping the click destinations", () => {
    const base = {
      partialSessionId: "trace-1",
      taskLabel: "Overview of access levels",
      deliveredTo: "letterman",
      workspaceId: "ws-1",
      targetSessionId: "seg-2",
    };
    expect(buildToolCallPointer({ ...base, status: "pending" })!.status).toBe("queued");
    expect(buildToolCallPointer({ ...base, status: "claimed" })!.status).toBe("working");
    expect(buildToolCallPointer({ ...base, status: "failed" })!.status).toBe("failed");
    expect(buildToolCallPointer({ ...base, status: "completed" })).toEqual({
      partialSessionId: "trace-1",
      taskLabel: "Overview of access levels",
      targetLabel: "letterman",
      status: "completed",
      targetSessionId: "seg-2",
      workspaceId: "ws-1",
    });
  });

  it("builds nothing for a delivery hop (null taskLabel) or a keyless row", () => {
    expect(
      buildToolCallPointer({
        partialSessionId: "trace-r",
        status: "completed",
        taskLabel: null,
        deliveredTo: "Global",
      }),
    ).toBeNull();
    expect(
      buildToolCallPointer({ partialSessionId: null, status: "completed", taskLabel: "t" }),
    ).toBeNull();
  });
});

// The AGENT-SPAWN pointer (Kafi, 2026-08-18): the system Agent/Task tool
// wears the same pointer a delegated task does — anchored on the spawning
// call's toolUseId, its door the nested activity pane, its activity line the
// run's latest act.
describe("buildAgentRunPointer", () => {
  const spawn = {
    toolUseId: "toolu_1",
    toolName: "Agent",
    toolInput: {
      description: "Whoami check",
      prompt: "Call the whoami tool and report.",
      subagent_type: "Explore",
    },
  };

  it("builds nothing for an ordinary tool call", () => {
    expect(isAgentSpawnToolCall("Read")).toBe(false);
    expect(
      buildAgentRunPointer({ ...spawn, toolName: "Read", status: "started" }, null, "s1"),
    ).toBeNull();
  });

  it("labels from the spawn input and anchors the door on the call", () => {
    const pointer = buildAgentRunPointer({ ...spawn, status: "started" }, null, "s1");
    expect(pointer).toMatchObject({
      partialSessionId: "toolu_1",
      taskLabel: "Whoami check",
      targetLabel: "Explore",
      status: "working",
      targetSessionId: null,
      workspaceId: null,
      agentRun: { hostSessionId: "s1", toolUseId: "toolu_1" },
    });
    // A running spawn with no recorded activity still reads alive.
    expect(pointer!.activityLine).toBe("Working…");
  });

  it("falls back to the prompt's lead line, then a generic label", () => {
    const promptOnly = buildAgentRunPointer(
      {
        toolUseId: "toolu_2",
        toolName: "Task",
        toolInput: { prompt: "\nMap the pointer view.\nThen report." },
        status: "started",
      },
      null,
      null,
    );
    expect(promptOnly).toMatchObject({
      taskLabel: "Map the pointer view.",
      targetLabel: "Agent",
      agentRun: { hostSessionId: null, toolUseId: "toolu_2" },
    });
    expect(
      buildAgentRunPointer(
        { toolUseId: "toolu_3", toolName: "Agent", toolInput: null, status: "started" },
        null,
        null,
      )!.taskLabel,
    ).toBe("Agent task");
  });

  it("maps the call's settle onto the pointer state", () => {
    expect(buildAgentRunPointer({ ...spawn, status: "completed" }, null, "s1")!.status).toBe(
      "completed",
    );
    expect(
      buildAgentRunPointer({ ...spawn, status: "completed", isErrorResult: true }, null, "s1")!
        .status,
    ).toBe("failed");
    expect(buildAgentRunPointer({ ...spawn, status: "failed" }, null, "s1")!.status).toBe("failed");
    expect(buildAgentRunPointer({ ...spawn, status: "cancelled" }, null, "s1")!.status).toBe(
      "failed",
    );
  });

  it("speaks the run's latest act: last nested call first, narrative tail as fallback", () => {
    const withCalls = buildAgentRunPointer({ ...spawn, status: "started" }, {
      text: "Looking around.",
      toolCalls: [
        { toolUseId: "c1", toolName: "Read", toolInput: { file_path: "docs/plan.md" } },
        { toolUseId: "c2", toolName: "Grep", toolInput: { pattern: "pointer" } },
      ],
    }, "s1");
    expect(withCalls!.activityLine).toContain("pointer");

    const narrativeOnly = buildAgentRunPointer({ ...spawn, status: "completed" }, {
      text: "First line.\n\nThe final report line.\n",
      toolCalls: [],
    }, "s1");
    expect(narrativeOnly!.activityLine).toBe("The final report line.");

    // A settled run with nothing recorded shows no line at all.
    expect(
      buildAgentRunPointer({ ...spawn, status: "completed" }, null, "s1")!.activityLine,
    ).toBeNull();
  });
});
