import { describe, it, expect } from "vitest";
import { buildThreadPointers, buildToolCallPointer } from "./thread-pointers.js";

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
