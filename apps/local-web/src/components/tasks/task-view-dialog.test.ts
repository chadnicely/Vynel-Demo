// Tests for the task view's steps section — the task's OWN durable steps
// render first (task-execution arc); the legacy session-dock read is the
// fallback for tasks that predate task steps; a task that never ran shows no
// steps at all. Plus the plan chip's two relations and the connected-session
// chip.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import TaskViewDialog from "./TaskViewDialog.vue";

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    userId: "u1",
    workspaceId: null,
    title: "Ship the rail",
    detail: null,
    status: "in-progress",
    source: "assistant",
    sessionId: "s1",
    planId: null,
    assignedSessionId: null,
    completedAt: null,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}

function makeTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    userId: "u1",
    workspaceId: null,
    sessionId: "s1",
    title: "A step",
    status: "open",
    orderIndex: 0,
    completedAt: null,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    userId: "u1",
    workspaceId: null,
    taskId: "t1",
    planId: null,
    sessionId: null,
    title: "A task step",
    status: "open",
    orderIndex: 0,
    completedAt: null,
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

// The dialog reads four surfaces now — quiet defaults so each test only names
// the piece it exercises.
function makeClient(overrides: Record<string, unknown> = {}): VynelClient {
  return {
    tasksUser: { list: async () => [makeTask()], listSteps: async () => [] },
    todos: { list: async () => [] },
    plansUser: { list: async () => [] },
    ...overrides,
  } as unknown as VynelClient;
}

function mountDialog(client: VynelClient, taskId = "t1") {
  return mount(TaskViewDialog, {
    props: { open: true, taskId },
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: client },
      // No real router in these mounts — the chip's navigation is the
      // router's business, not this dialog's.
      stubs: { RouterLink: { template: "<a><slot /></a>" } },
    },
  });
}

afterEach(() => {
  // The Modal teleports to body — reset between tests so text assertions
  // never read a previous dialog's remains.
  document.body.innerHTML = "";
});

describe("TaskViewDialog", () => {
  it("the task's OWN steps win — the legacy dock read never fires when they exist", async () => {
    const todosCalls: unknown[] = [];
    const client = makeClient({
      tasksUser: {
        list: async () => [makeTask()],
        listSteps: async () => [
          makeStep({ title: "Lay the schema", status: "done", completedAt: "2026-08-18T10:05:00.000Z" }),
          makeStep({ title: "Wire the routes", orderIndex: 1 }),
        ],
      },
      todos: {
        list: async (input: unknown) => {
          todosCalls.push(input);
          return [makeTodo({ title: "Old dock step" })];
        },
      },
    });

    const wrapper = mountDialog(client);
    await flushPromises();

    const body = document.body.textContent ?? "";
    expect(body).toContain("Lay the schema");
    expect(body).toContain("1 of 2");
    expect(body).not.toContain("Old dock step");
    expect(todosCalls).toEqual([]);
    wrapper.unmount();
  });

  it("falls back to the session's dock todos ONLY after the steps query settles empty", async () => {
    const client = makeClient({
      todos: {
        list: async () => [
          makeTodo({ title: "Wire it up", orderIndex: 1 }),
          makeTodo({
            title: "Read the code",
            orderIndex: 0,
            status: "done",
            completedAt: "2026-08-14T10:05:00.000Z",
          }),
        ],
      },
    });

    const wrapper = mountDialog(client);
    await flushPromises();

    const body = document.body.textContent ?? "";
    expect(body).toContain("Steps");
    expect(body).toContain("1 of 2");
    // Sorted by orderIndex — "Read the code" (0) before "Wire it up" (1).
    expect(body.indexOf("Read the code")).toBeLessThan(
      body.indexOf("Wire it up"),
    );
    wrapper.unmount();
  });

  it("shows no steps section for a task that never ran", async () => {
    const listCalls: unknown[] = [];
    const client = makeClient({
      tasksUser: {
        list: async () => [makeTask({ sessionId: null })],
        listSteps: async () => [],
      },
      todos: {
        list: async (input: unknown) => {
          listCalls.push(input);
          return [];
        },
      },
    });

    const wrapper = mountDialog(client);
    await flushPromises();

    expect(document.body.textContent).not.toContain("Steps");
    // No session — the todos query never fires.
    expect(listCalls).toEqual([]);
    wrapper.unmount();
  });

  it("the plan chip appears for an EXECUTION plan found by taskId (no task.planId)", async () => {
    const planCalls: unknown[] = [];
    const client = makeClient({
      plansUser: {
        list: async (query: unknown) => {
          planCalls.push(query);
          return [{ id: "p1", taskId: "t1" }];
        },
      },
    });

    const wrapper = mountDialog(client);
    await flushPromises();

    expect(document.body.textContent).toContain("View plan");
    expect(planCalls).toEqual([{ taskId: "t1" }]);
    wrapper.unmount();
  });

  it("the connected-session chip renders only when a session is assigned", async () => {
    const assigned = mountDialog(
      makeClient({
        tasksUser: {
          list: async () => [makeTask({ assignedSessionId: "s-work", workspaceId: "w1" })],
          listSteps: async () => [],
        },
      }),
    );
    await flushPromises();
    expect(document.body.textContent).toContain("Connected session");
    assigned.unmount();
    document.body.innerHTML = "";

    const unassigned = mountDialog(makeClient());
    await flushPromises();
    expect(document.body.textContent).not.toContain("Connected session");
    unassigned.unmount();
  });
});
