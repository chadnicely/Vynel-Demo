import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import type { SessionTodoResponse } from "@vynel/contracts/tasks/session-todo-http";
import TodoDock from "./TodoDock.vue";

function makeTodo(
  overrides: Partial<SessionTodoResponse> = {},
): SessionTodoResponse {
  return {
    id: "todo-1",
    userId: "u1",
    workspaceId: null,
    sessionId: "session-1",
    title: "Read the brief",
    status: "open",
    orderIndex: 0,
    completedAt: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    todos: {
      list: async () => [makeTodo()],
      updateStatus: async () => makeTodo({ status: "done" }),
      delete: async () => undefined,
      ...overrides,
    },
  } as unknown as VynelClient;
}

function mountDock(client: VynelClient, sessionId: string | null = "session-1") {
  return mount(TodoDock, {
    props: { sessionId },
    global: {
      plugins: [
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

describe("TodoDock", () => {
  it("renders nothing when the session has no steps", async () => {
    const wrapper = mountDock(makeClient({ list: async () => [] }));
    await flushPromises();

    expect(wrapper.find(".todo-dock").exists()).toBe(false);
  });

  it("renders nothing — and never asks the server — with no session at all", async () => {
    const list = vi.fn(async () => [makeTodo()]);
    const wrapper = mountDock(makeClient({ list }), null);
    await flushPromises();

    expect(wrapper.find(".todo-dock").exists()).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });

  it("shows every step with its state, highlighting the one in progress", async () => {
    const wrapper = mountDock(
      makeClient({
        list: async () => [
          makeTodo({ id: "t1", title: "Read the brief", status: "done" }),
          makeTodo({ id: "t2", title: "Draft the copy", status: "in-progress" }),
          makeTodo({ id: "t3", title: "Send it", status: "open" }),
        ],
      }),
    );
    await flushPromises();

    const rows = wrapper.findAll(".todo-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.classes()).toContain("is-done");
    expect(rows[1]!.classes()).toContain("is-active");
    expect(rows[2]!.classes()).not.toContain("is-active");
    expect(wrapper.get(".todo-head-count").text()).toBe("1/3");
  });

  it("ticking a step calls updateStatus with 'done'; ticking a done one reopens it", async () => {
    const updateStatus = vi.fn(async () => makeTodo({ status: "done" }));
    const wrapper = mountDock(
      makeClient({
        list: async () => [
          makeTodo({ id: "t1", title: "Open one" }),
          makeTodo({ id: "t2", title: "Done one", status: "done" }),
        ],
        updateStatus,
      }),
    );
    await flushPromises();

    await wrapper.findAll(".todo-check")[0]!.trigger("click");
    await flushPromises();
    expect(updateStatus).toHaveBeenCalledWith("t1", { status: "done" });

    await wrapper.findAll(".todo-check")[1]!.trigger("click");
    await flushPromises();
    expect(updateStatus).toHaveBeenCalledWith("t2", { status: "open" });
  });

  it("the remove affordance deletes that step", async () => {
    const remove = vi.fn(async () => undefined);
    const wrapper = mountDock(makeClient({ delete: remove }));
    await flushPromises();

    await wrapper.get(".todo-remove").trigger("click");
    await flushPromises();

    expect(remove).toHaveBeenCalledWith("todo-1");
  });

  it("folds a long list to the current step, and the header unfolds it", async () => {
    const wrapper = mountDock(
      makeClient({
        list: async () =>
          Array.from({ length: 7 }, (_, index) =>
            makeTodo({
              id: `t${index}`,
              title: `Step ${index}`,
              status: index === 3 ? "in-progress" : "open",
              orderIndex: index,
            }),
          ),
      }),
    );
    await flushPromises();

    expect(wrapper.findAll(".todo-row")).toHaveLength(1);
    expect(wrapper.get(".todo-row").text()).toContain("Step 3"); // the one in progress
    expect(wrapper.get(".todo-folded-note").text()).toBe("6 more");

    await wrapper.get(".todo-head").trigger("click");
    expect(wrapper.findAll(".todo-row")).toHaveLength(7);
    expect(wrapper.find(".todo-folded-note").exists()).toBe(false);
  });
});
