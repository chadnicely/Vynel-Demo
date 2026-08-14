// Tests for the task view's steps section (redesign Arc 5) — the session's
// REAL todos render sorted with honest progress; a task that never ran shows
// no steps at all.

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
    },
  });
}

afterEach(() => {
  // The Modal teleports to body — reset between tests so text assertions
  // never read a previous dialog's remains.
  document.body.innerHTML = "";
});

describe("TaskViewDialog", () => {
  it("renders the session's steps sorted, with honest progress", async () => {
    const client = {
      tasksUser: { list: async () => [makeTask()] },
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
    } as unknown as VynelClient;

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
    const client = {
      tasksUser: { list: async () => [makeTask({ sessionId: null })] },
      todos: {
        list: async (input: unknown) => {
          listCalls.push(input);
          return [];
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountDialog(client);
    await flushPromises();

    expect(document.body.textContent).not.toContain("Steps");
    // No session — the todos query never fires.
    expect(listCalls).toEqual([]);
    wrapper.unmount();
  });
});
