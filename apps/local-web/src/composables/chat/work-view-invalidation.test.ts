import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/vue-query";
import {
  invalidateWorkViews,
  isWorkMutatingToolName,
} from "./work-view-invalidation.js";
import { taskKeys } from "../tasks/task-keys.js";
import { todoKeys } from "../todos/todo-keys.js";
import { dashboardKeys } from "../dashboard/dashboard-keys.js";

describe("isWorkMutatingToolName", () => {
  it("matches the assistant's own task + step writers only", () => {
    expect(isWorkMutatingToolName("mcp__vynel__set_todos")).toBe(true);
    expect(isWorkMutatingToolName("mcp__vynel__create_task")).toBe(true);
    expect(isWorkMutatingToolName("mcp__vynel__update_task")).toBe(true);
    expect(isWorkMutatingToolName("mcp__vynel__complete_task")).toBe(true);

    // Reads and unrelated tools must not trigger a refresh storm.
    expect(isWorkMutatingToolName("mcp__vynel__list_tasks")).toBe(false);
    expect(isWorkMutatingToolName("Bash")).toBe(false);
    expect(isWorkMutatingToolName("set_todos")).toBe(false);
  });
});

describe("invalidateWorkViews", () => {
  it("refreshes the task list, the dashboard card AND every step dock", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await invalidateWorkViews(queryClient);

    // `invalidateQueries` accepts filters OR a getter — normalize before reading.
    const invalidatedKeys = invalidate.mock.calls.map((call) => {
      const filters = call[0];
      return typeof filters === "function" ? filters().queryKey : filters?.queryKey;
    });
    expect(invalidatedKeys).toContainEqual(taskKeys.all);
    expect(invalidatedKeys).toContainEqual(todoKeys.all);
    expect(invalidatedKeys).toContainEqual(dashboardKeys.overview());
  });
});
