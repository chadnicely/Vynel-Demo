// The one reading of "the queue" per project. These are the exact edges that
// decide a project's colour on the node screen and the sidebar's dot, so each
// boolean branch is pinned rather than inferred.

import { describe, expect, it } from "vitest";
import {
  isCompletedAndClear,
  isQueueWorking,
  taskQueueByWorkspace,
} from "./task-queue-summary.js";

describe("taskQueueByWorkspace", () => {
  it("groups by project and counts open, running and total", () => {
    const queues = taskQueueByWorkspace([
      { workspaceId: "ws-1", status: "done" },
      { workspaceId: "ws-1", status: "in-progress" },
      { workspaceId: "ws-1", status: "pending" },
      { workspaceId: "ws-2", status: "done" },
    ]);
    expect(queues.get("ws-1")).toEqual({
      openCount: 2,
      inProgressCount: 1,
      total: 3,
    });
    expect(queues.get("ws-2")).toEqual({
      openCount: 0,
      inProgressCount: 0,
      total: 1,
    });
  });

  it("ignores global tasks — they never colour a project's dot", () => {
    const queues = taskQueueByWorkspace([{ workspaceId: null, status: "pending" }]);
    expect(queues.size).toBe(0);
  });

  it("survives no tasks at all", () => {
    expect(taskQueueByWorkspace(undefined).size).toBe(0);
  });
});

describe("isQueueWorking", () => {
  it("is true only while something is actually running", () => {
    expect(isQueueWorking({ openCount: 3, inProgressCount: 1, total: 4 })).toBe(true);
    expect(isQueueWorking({ openCount: 3, inProgressCount: 0, total: 4 })).toBe(false);
    expect(isQueueWorking(undefined)).toBe(false);
  });
});

describe("isCompletedAndClear", () => {
  const drained = { openCount: 0, inProgressCount: 0, total: 2 };

  it("anything left in the queue keeps it amber", () => {
    expect(
      isCompletedAndClear({ openCount: 1, inProgressCount: 0, total: 3 }, {
        done: 4,
        total: 4,
      }),
    ).toBe(false);
  });

  it("every planned step finished is green", () => {
    expect(isCompletedAndClear(undefined, { done: 4, total: 4 })).toBe(true);
  });

  it("a queue that held tasks and drained them is green on its own", () => {
    expect(isCompletedAndClear(drained, null)).toBe(true);
  });

  it("a project that never planned steps and never queued anything is not done", () => {
    // The empty-everything case must not read as an accomplishment.
    expect(isCompletedAndClear(undefined, undefined)).toBe(false);
    expect(isCompletedAndClear(undefined, null)).toBe(false);
    expect(isCompletedAndClear({ openCount: 0, inProgressCount: 0, total: 0 }, null)).toBe(
      false,
    );
  });

  it("a zero-step plan is not a finished plan", () => {
    expect(isCompletedAndClear(undefined, { done: 0, total: 0 })).toBe(false);
  });

  it("steps still in flight are not done", () => {
    expect(isCompletedAndClear(undefined, { done: 2, total: 5 })).toBe(false);
  });
});
