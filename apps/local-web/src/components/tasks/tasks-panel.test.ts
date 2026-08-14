// Tests for the work rail (redesign Arc 4 — evolved from the tasks dock; the
// original dock pins carry over, adapted to the rail's DOM: the open-count
// moved from the header chip to the queue tab, done rows moved behind the
// Completed tab).

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import { useActivityStore } from "../../stores/activity-store.js";
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
    planId: null,
    completedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

// The rail reads more surfaces than the old dock (presence, todos, apps) —
// quiet stubs so each test only names the piece it exercises.
function makeClient(overrides: Record<string, unknown> = {}): VynelClient {
  return {
    tasksUser: { list: async () => [] },
    todos: { list: async () => [] },
    workspaceApps: { list: async () => [] },
    approvals: { listPending: async () => [] },
    asks: { listPending: async () => [] },
    ...overrides,
  } as unknown as VynelClient;
}

function mountPanel(
  client: VynelClient,
  scope: SectionScope = { kind: "global" },
  pinia: Pinia = createPinia(),
) {
  return mount(TasksPanel, {
    props: { scope },
    global: {
      plugins: [
        pinia,
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

function queueTab(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('[role="tab"]')[0]!;
}

describe("TasksPanel (work rail)", () => {
  it("the queue lists only open work, with the count on its tab", async () => {
    const client = makeClient({
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({ id: "t2", title: "Draft the brief", status: "in-progress" }),
          makeTask({
            id: "t3",
            title: "Old news",
            status: "done",
            completedAt: "2026-07-04T10:00:00.000Z",
          }),
        ],
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();

    expect(wrapper.text()).toContain("Ship the launch email");
    expect(wrapper.text()).toContain("Draft the brief");
    // Done rows live behind the Completed tab now, not in the queue.
    expect(wrapper.text()).not.toContain("Old news");
    expect(queueTab(wrapper).get(".tab-count").text()).toBe("2");
  });

  it("narrows to the scope it sits in — global shows only global work", async () => {
    const client = makeClient({
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({ id: "t2", workspaceId: "w1", title: "Room work" }),
        ],
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();

    expect(wrapper.text()).toContain("Ship the launch email");
    expect(wrapper.text()).not.toContain("Room work");
    expect(queueTab(wrapper).get(".tab-count").text()).toBe("1");
  });

  // test: correct expectation for scope visibility — was "workspace = own +
  // global", now STRICT per Chad's rule (the channels convention): the dock
  // reads the same scoped query as the tasks menu, workspace rows only.
  it("a workspace surface sees ONLY its own work, via the workspace route", async () => {
    const listCalls: string[] = [];
    const client = makeClient({
      tasks: {
        list: async (workspaceId: string) => {
          listCalls.push(workspaceId);
          return [makeTask({ id: "t2", workspaceId: "w1", title: "Room work" })];
        },
      },
    });

    const wrapper = mountPanel(client, { kind: "workspace", workspaceId: "w1" });
    await flushPromises();

    expect(listCalls).toEqual(["w1"]);
    expect(wrapper.text()).toContain("Room work");
    expect(wrapper.text()).not.toContain("Ship the launch email");
    expect(queueTab(wrapper).get(".tab-count").text()).toBe("1");
  });

  it("cycles a task's status from its compact control", async () => {
    const updateCalls: unknown[] = [];
    const client = makeClient({
      tasksUser: {
        list: async () => [makeTask()],
        update: async (taskId: string, patch: unknown) => {
          updateCalls.push([taskId, patch]);
          return makeTask({ status: "in-progress" });
        },
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();

    await wrapper.get('[aria-label="Start this task"]').trigger("click");
    await flushPromises();

    expect(updateCalls).toEqual([["t1", { status: "in-progress" }]]);
  });

  it("shows the empty state when nothing is open", async () => {
    const wrapper = mountPanel(makeClient());
    await flushPromises();

    expect(wrapper.text()).toContain("Nothing on the list");
    expect(queueTab(wrapper).get(".tab-count").text()).toBe("0");
  });

  // ── The rail's own additions. ──

  it("the in-progress task leads the queue and names the live card", async () => {
    const client = makeClient({
      tasks: {
        list: async () => [
          makeTask({ id: "t2", workspaceId: "w1", title: "Write the docs" }),
          makeTask({
            id: "t3",
            workspaceId: "w1",
            title: "Ship the rail",
            status: "in-progress",
          }),
        ],
      },
    });

    const wrapper = mountPanel(client, { kind: "workspace", workspaceId: "w1" });
    await flushPromises();

    const rows = wrapper.findAll(".task-row .task-title");
    expect(rows[0]!.text()).toBe("Ship the rail");
    expect(wrapper.find(".live-title").text()).toBe("Ship the rail");
  });

  it("stop → confirm interrupts the room's live session", async () => {
    const interruptCalls: unknown[] = [];
    const client = makeClient({
      tasks: { list: async () => [] },
      chat: {
        interruptSession: async (workspaceId: string, sessionId: string) => {
          interruptCalls.push([workspaceId, sessionId]);
        },
      },
    });

    // A live server turn in this room — presence reads "working" and the
    // stop control targets its session.
    const pinia = createPinia();
    setActivePinia(pinia);
    useActivityStore().applyServerActivity({
      kind: "turn-started",
      turnId: "turn-1",
      scopeKind: "workspace",
      workspaceId: "w1",
      sessionId: "s-live",
      origin: "web",
      startedAt: "2026-08-14T10:00:00.000Z",
    });

    const wrapper = mountPanel(
      client,
      { kind: "workspace", workspaceId: "w1" },
      pinia,
    );
    await flushPromises();

    expect(wrapper.find(".live-kicker").text()).toContain("working");
    await wrapper.get(".abort-button").trigger("click");
    await wrapper.get(".abort-do").trigger("click");
    await flushPromises();

    expect(interruptCalls).toEqual([["w1", "s-live"]]);
    expect(wrapper.find(".abort-confirm").exists()).toBe(false);
  });

  it("reads quiet when nothing is happening — no abort, no fake progress", async () => {
    const wrapper = mountPanel(makeClient(), {
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    expect(wrapper.find(".live-kicker").text()).toContain("All quiet");
    expect(wrapper.find(".live-title").text()).toBe("Nothing running");
    expect(wrapper.find(".live-bar").exists()).toBe(false);
    expect(wrapper.find(".abort-button").exists()).toBe(false);
    expect(wrapper.text()).toContain("Nothing running to open");
  });
});
