import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import type { SectionScope } from "../sections/section-scope.js";
import TasksPanel from "./TasksPanel.vue";

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    userId: "u1",
    workspaceId: null,
    title: "Ship the launch email",
    detail: null,
    status: "open",
    source: "user",
    sessionId: null,
    completedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function mountPanel(
  client: VynelClient,
  scope: SectionScope = { kind: "global" },
) {
  return mount(TasksPanel, {
    props: { scope },
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

describe("TasksPanel", () => {
  it("lists only open work, with the count in the header", async () => {
    const client = {
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({ id: "t2", title: "Draft the brief", status: "in-progress" }),
          makeTask({ id: "t3", title: "Old news", status: "done" }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountPanel(client);
    await flushPromises();

    expect(wrapper.text()).toContain("Ship the launch email");
    expect(wrapper.text()).toContain("Draft the brief");
    expect(wrapper.text()).not.toContain("Old news");
    expect(wrapper.get(".count-chip").text()).toBe("2 open");
  });

  it("narrows to the scope it sits in — global shows only global work", async () => {
    const client = {
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({ id: "t2", workspaceId: "w1", title: "Room work" }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountPanel(client);
    await flushPromises();

    expect(wrapper.text()).toContain("Ship the launch email");
    expect(wrapper.text()).not.toContain("Room work");
    expect(wrapper.get(".count-chip").text()).toBe("1 open");
  });

  // test: correct expectation for scope visibility — was "workspace = own +
  // global", now STRICT per Chad's rule (the channels convention): the dock
  // reads the same scoped query as the tasks menu, workspace rows only.
  it("a workspace surface sees ONLY its own work, via the workspace route", async () => {
    const listCalls: string[] = [];
    const client = {
      tasks: {
        list: async (workspaceId: string) => {
          listCalls.push(workspaceId);
          return [makeTask({ id: "t2", workspaceId: "w1", title: "Room work" })];
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountPanel(client, { kind: "workspace", workspaceId: "w1" });
    await flushPromises();

    expect(listCalls).toEqual(["w1"]);
    expect(wrapper.text()).toContain("Room work");
    expect(wrapper.text()).not.toContain("Ship the launch email");
    expect(wrapper.get(".count-chip").text()).toBe("1 open");
  });

  it("cycles a task's status from its compact control", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      tasksUser: {
        list: async () => [makeTask()],
        update: async (taskId: string, patch: unknown) => {
          updateCalls.push([taskId, patch]);
          return makeTask({ status: "in-progress" });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountPanel(client);
    await flushPromises();

    await wrapper.get('[aria-label="Start this task"]').trigger("click");
    await flushPromises();

    expect(updateCalls).toEqual([["t1", { status: "in-progress" }]]);
  });

  it("shows the empty state when nothing is open", async () => {
    const client = {
      tasksUser: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountPanel(client);
    await flushPromises();

    expect(wrapper.text()).toContain("Nothing on the list");
    expect(wrapper.get(".count-chip").text()).toBe("0 open");
  });
});
