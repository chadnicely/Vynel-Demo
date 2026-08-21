import { describe, expect, it } from "vitest";
import type { TaskStepResponse } from "@vynel/contracts/tasks/task-step-http";
import { currentStepOf } from "./current-step.js";

function step(title: string, status: TaskStepResponse["status"]): TaskStepResponse {
  return { id: title, title, status } as unknown as TaskStepResponse;
}

describe("currentStepOf", () => {
  it("is the step in progress, numbered from one", () => {
    expect(
      currentStepOf([step("a", "done"), step("b", "done"), step("c", "in-progress"), step("d", "open")]),
    ).toEqual({ number: 3, title: "c" });
  });

  it("falls back to the first open step when nothing is marked in progress", () => {
    expect(currentStepOf([step("a", "done"), step("b", "open"), step("c", "open")])).toEqual({
      number: 2,
      title: "b",
    });
  });

  it("is null when every step is done, or there are none", () => {
    expect(currentStepOf([step("a", "done")])).toBeNull();
    expect(currentStepOf([])).toBeNull();
  });
});
