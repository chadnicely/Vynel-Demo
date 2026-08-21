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
    tasksUser: { list: async () => [], listSteps: async () => [] },
    todos: { list: async () => [] },
    plansUser: { list: async () => [] },
    workspaceApps: { list: async () => [] },
    approvals: { listPending: async () => [] },
    asks: { listPending: async () => [] },
    ...overrides,
  } as unknown as VynelClient;
}

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: "step-1",
    userId: "u1",
    workspaceId: null,
    taskId: "t1",
    planId: null,
    sessionId: null,
    title: "Read the brief",
    status: "open",
    orderIndex: 0,
    completedAt: null,
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
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
    expect(rows[0]!.text()).toBe("1. Ship the rail");
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

  it("a row's title opens the full task view", async () => {
    const client = makeClient({
      tasksUser: {
        list: async () => [
          makeTask({ detail: "All the fine print lives here." }),
        ],
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();

    await wrapper.get(".task-title").trigger("click");
    await flushPromises();

    // The Modal teleports to body — assert the portal, not the wrapper.
    expect(document.body.textContent).toContain(
      "All the fine print lives here.",
    );
    wrapper.unmount();
  });

  it("the + button quick-adds a task scoped to the rail", async () => {
    const createCalls: unknown[] = [];
    const client = makeClient({
      tasks: { list: async () => [] },
      tasksUser: {
        list: async () => [],
        create: async (input: unknown) => {
          createCalls.push(input);
          return makeTask({ id: "t-new", workspaceId: "w1", title: "Wire it" });
        },
      },
    });

    const wrapper = mountPanel(client, { kind: "workspace", workspaceId: "w1" });
    await flushPromises();

    await wrapper.get('[aria-label="Add a task"]').trigger("click");
    const input = wrapper.get(".create-input");
    await input.setValue("  Wire it  ");
    // Form submit — the component uses implicit submission (IME-safe), which
    // jsdom doesn't synthesize from a keydown.
    await wrapper.get(".create-row").trigger("submit");
    await flushPromises();

    expect(createCalls).toEqual([
      { scope: "workspace", workspaceId: "w1", title: "Wire it" },
    ]);
    expect(wrapper.find(".create-input").exists()).toBe(false);
  });

  // ── The task-execution arc's additions (2026-08-18). ──

  it("the activity header shows done/total, and rows with steps carry n/m + an expander", async () => {
    const stepsCalls: string[] = [];
    const client = makeClient({
      tasksUser: {
        list: async () => [
          makeTask({ stepsDone: 1, stepsTotal: 3 }),
          makeTask({ id: "t2", title: "No steps yet" }),
          makeTask({
            id: "t3",
            title: "Old win",
            status: "done",
            completedAt: "2026-08-17T10:00:00.000Z",
          }),
        ],
        listSteps: async (taskId: string) => {
          stepsCalls.push(taskId);
          return [
            makeStep({ status: "done", completedAt: "2026-08-18T10:05:00.000Z" }),
            makeStep({ id: "step-2", title: "Draft the copy", orderIndex: 1 }),
          ];
        },
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();

    expect(wrapper.get(".activity-line").text()).toContain("1/3");
    // Only the task WITH steps gets the fold; its collapsed face is n/m.
    const toggles = wrapper.findAll(".step-toggle");
    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.get(".step-count").text()).toBe("1/3");

    await toggles[0]!.trigger("click");
    await flushPromises();

    expect(stepsCalls).toEqual(["t1"]);
    const stepTitles = wrapper.findAll(".step-title").map((node) => node.text());
    expect(stepTitles).toEqual(["Read the brief", "Draft the copy"]);
  });

  it("the ACTIVE task breathes its current step under the row — count on the sub-line, caret alone on the row", async () => {
    const client = makeClient({
      tasksUser: {
        list: async () => [
          makeTask({
            status: "in-progress",
            stepsDone: 2,
            stepsTotal: 5,
          }),
        ],
        listSteps: async () => [
          makeStep({ status: "done" }),
          makeStep({ id: "s2", orderIndex: 1, status: "done" }),
          makeStep({ id: "s3", orderIndex: 2, title: "The middle of the work", status: "in-progress" }),
          makeStep({ id: "s4", orderIndex: 3 }),
          makeStep({ id: "s5", orderIndex: 4 }),
        ],
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();

    const subline = wrapper.get(".live-step-line");
    expect(subline.text()).toContain("3. The middle of the work");
    expect(subline.text()).toContain("2/5");
    // The row hands its meta to the sub-line: no "now", no count — caret only.
    expect(wrapper.find(".task-meta.is-live").exists()).toBe(false);
    expect(wrapper.find(".step-toggle .step-count").exists()).toBe(false);
    expect(wrapper.get(".task-row").classes()).toContain("is-live");

    // Expanding swaps the sub-line for the full list (+ the icon row needs
    // an assigned session or plan — none here, so no actions row).
    await wrapper.get(".step-toggle").trigger("click");
    await flushPromises();
    expect(wrapper.find(".live-step-line").exists()).toBe(false);
    expect(wrapper.findAll(".step-row")).toHaveLength(5);
  });

  // Kafi, 2026-08-22: EVERY in-progress task breathes its own current step —
  // not only the first — each from its own plan; one without steps keeps the
  // plain "now".
  it("every in-progress task carries its own current-step sub-line", async () => {
    const stepsByTask: Record<string, ReturnType<typeof makeStep>[]> = {
      "t-1": [makeStep({ status: "done" }), makeStep({ id: "s2", orderIndex: 1, title: "Draft the outline", status: "in-progress" })],
      "t-2": [makeStep({ title: "Pull the first fifty rows", status: "open" })],
    };
    const client = makeClient({
      tasksUser: {
        list: async () => [
          makeTask({ id: "t-1", title: "First", status: "in-progress", stepsDone: 1, stepsTotal: 2 }),
          makeTask({ id: "t-2", title: "Second", status: "in-progress", stepsDone: 0, stepsTotal: 1 }),
          makeTask({ id: "t-3", title: "Third", status: "in-progress", stepsDone: 0, stepsTotal: 0 }),
        ],
        listSteps: async (taskId: string) => stepsByTask[taskId] ?? [],
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();

    const sublines = wrapper.findAll(".live-step-line");
    expect(sublines.map((line) => line.text())).toEqual([
      expect.stringContaining("2. Draft the outline"),
      expect.stringContaining("1. Pull the first fifty rows"),
    ]);
    // The stepless third task still says "now" on its row.
    expect(wrapper.findAll(".task-meta.is-live")).toHaveLength(1);
  });

  it("an expanded task with an assigned session shows the Plan/Session doors", async () => {
    const client = makeClient({
      tasksUser: {
        list: async () => [
          makeTask({ planId: "p1", assignedSessionId: "s-work", stepsDone: 0, stepsTotal: 1 }),
        ],
        listSteps: async () => [makeStep()],
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get(".step-toggle").trigger("click");
    await flushPromises();

    const actions = wrapper.findAll(".step-action").map((node) => node.text());
    expect(actions).toEqual(["Plan", "Session"]);
  });

  it("ticking an expanded step patches it through the user step door", async () => {
    const patchCalls: unknown[] = [];
    const client = makeClient({
      tasksUser: {
        list: async () => [makeTask({ stepsDone: 0, stepsTotal: 1 })],
        listSteps: async () => [makeStep()],
        updateStepStatus: async (stepId: string, patch: unknown) => {
          patchCalls.push([stepId, patch]);
          return makeStep({ status: "done" });
        },
      },
    });

    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get(".step-toggle").trigger("click");
    await flushPromises();

    await wrapper.get(".step-tick").trigger("click");
    await flushPromises();

    expect(patchCalls).toEqual([["step-1", { status: "done" }]]);
  });

  it("the sessions box counts this scope's working turns and lists them on expand", async () => {
    const client = makeClient({
      sessions: {
        overview: async () => [
          {
            sessionId: "s-live",
            scope: "workspace",
            workspaceId: "w1",
            workspaceName: "Bakery",
            title: "Spring campaign",
            model: null,
            contextTokens: null,
            contextWindow: 200000,
            lastMessageAt: "2026-08-18T10:00:00.000Z",
            statusFacts: {},
            segments: [],
          },
        ],
      },
    });

    const pinia = createPinia();
    setActivePinia(pinia);
    useActivityStore().applyServerActivity({
      kind: "turn-started",
      turnId: "turn-1",
      scopeKind: "workspace",
      workspaceId: "w1",
      sessionId: "s-live",
      origin: "web",
      startedAt: "2026-08-18T10:00:00.000Z",
    });

    const wrapper = mountPanel(
      client,
      { kind: "workspace", workspaceId: "w1" },
      pinia,
    );
    await flushPromises();

    const box = wrapper.get(".sessions-box");
    expect(box.text()).toContain("1");
    expect(box.text()).toContain("session working");

    await box.trigger("click");
    await flushPromises();

    expect(wrapper.get(".sessions-title").text()).toBe("Spring campaign");
  });

  it("reads quiet when nothing is happening — no abort, no fake progress", async () => {
    const wrapper = mountPanel(makeClient(), {
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    expect(wrapper.find(".live-kicker").text()).toContain("Not running");
    expect(wrapper.find(".live-title").text()).toBe("Nothing running");
    expect(wrapper.find(".live-bar").exists()).toBe(false);
    expect(wrapper.find(".abort-button").exists()).toBe(false);
    expect(wrapper.text()).toContain("Nothing running to open");
  });
});
