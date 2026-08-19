// The Nodes screen's chrome. The constellation itself is canvas (its data
// mapping and its geometry are covered in constellation-layout.test.ts) —
// what this pins is the view around it: the invitation appears only on an
// empty fleet we have actually READ, the counts never claim a reading the
// polls have not answered, and a project node descends the level stack.

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { createAppRouter } from "../router.js";
import { vynelClientKey } from "../plugins/vynel-client.js";
import { useUiStore } from "../stores/ui-store.js";
import NodesView from "./NodesView.vue";

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    userId: "u-1",
    name: "Evernote",
    managerName: null,
    kind: "project",
    path: "C:/dev/evernote",
    isArchived: false,
    continueEnabled: true,
    groupId: null,
    status: null,
    statusNote: null,
    statusSetAt: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    lastAccessedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

/** A poll that never comes back — the window in which every dot would wear
 *  its grey fallback and the bar would announce "N idle". */
const neverAnswers = () => new Promise<never>(() => {});

async function mountView(
  workspaces: Array<Record<string, unknown>>,
  options: { statusPollsAnswer?: boolean } = {},
) {
  const answers = options.statusPollsAnswer ?? true;
  const client = {
    dashboard: {
      getOverview: async () => ({
        workspaces,
        recentSessions: [],
        upcomingSchedules: [],
        openTasks: [],
        recentlyCompletedTasks: [],
      }),
    },
    tasksUser: { list: async () => [] },
    sessions: { overview: async () => [] },
    // Read-only, and null until a room's first turn — asking never brings a
    // conversation into being.
    chat: {
      getContinuing: async () => ({
        rootSessionId: null,
        currentSdkSessionId: null,
        lastMessageAt: null,
      }),
    },
    todos: { list: async () => [] },
    activity: { listRecentMessages: async () => ({ edges: [] }) },
    // The three reads `hasAnsweredStatuses` is composed from.
    workspaces: { listStatuses: answers ? async () => [] : neverAnswers },
    approvals: { listPending: answers ? async () => [] : neverAnswers },
    asks: { listPending: answers ? async () => [] : neverAnswers },
  } as unknown as VynelClient;

  const pinia = createPinia();
  const router = createAppRouter();
  await router.push("/nodes");
  await router.isReady();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = mount(NodesView, {
    global: {
      plugins: [router, pinia, [VueQueryPlugin, { queryClient }]],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  await flushPromises();
  return { wrapper, pinia };
}

describe("NodesView", () => {
  it("an empty fleet shows the invitation over the lit stage", async () => {
    const { wrapper } = await mountView([]);
    expect(wrapper.text()).toContain("Nothing in orbit yet");
    // The scene mounts either way — the starfield and core are the point.
    expect(wrapper.find(".stage").exists()).toBe(true);
  });

  it("its CTA rings the create-workspace bell the shell watches", async () => {
    const { wrapper } = await mountView([]);
    const ui = useUiStore();
    expect(ui.createWorkspaceRequestCount).toBe(0);
    await wrapper.find("button.cta").trigger("click");
    expect(ui.createWorkspaceRequestCount).toBe(1);
  });

  it("with workspaces the invitation gives way to the constellation hint", async () => {
    const { wrapper } = await mountView([makeWorkspace()]);
    expect(wrapper.text()).not.toContain("Nothing in orbit yet");
    // The hint says only what the screen does: there is no tooltip, so it no
    // longer promises "hover a node for details" (D7 — the detail bag rides
    // every node, but rendering it is Kafi's visual pass).
    expect(wrapper.text()).toContain("click a node to open it");
    expect(wrapper.text()).not.toContain("hover a node");
  });

  it("an archived room is not a dot — only rooms that can still work orbit", async () => {
    const { wrapper } = await mountView([
      makeWorkspace({ id: "ws-archived", isArchived: true }),
    ]);
    expect(wrapper.text()).toContain("Nothing in orbit yet");
  });

  it("claims nothing while the status polls are still in flight", async () => {
    // The recorded bug in both halves: every project fell to its grey
    // fallback and the bar announced "N idle" for the whole poll flight, and
    // an empty fleet was declared before the read that would have filled it.
    const { wrapper } = await mountView([makeWorkspace()], {
      statusPollsAnswer: false,
    });
    expect(wrapper.text()).not.toContain("idle");
    expect(wrapper.text()).not.toContain("working");

    const answered = await mountView([makeWorkspace()]);
    expect(answered.wrapper.text()).toContain("1 idle");
  });

  it("holds the empty claim too, rather than inventing an empty fleet", async () => {
    const { wrapper } = await mountView([], { statusPollsAnswer: false });
    expect(wrapper.text()).not.toContain("Nothing in orbit yet");
  });

  it("a project node descends a level — same bar, its own crumb", async () => {
    const { wrapper } = await mountView([makeWorkspace()]);
    const ui = useUiStore();
    // The canvas is a no-op without a 2D context, so the click comes through
    // the Grid reading of the same level — one `onNodeClick` for both.
    ui.nodesMode = "grid";
    await flushPromises();

    expect(wrapper.text()).not.toContain("All projects");
    await wrapper.find("button.card").trigger("click");
    await flushPromises();

    // The crumb pair: the way back, and where you are standing.
    expect(wrapper.find("button.crumb").text()).toContain("All projects");
    expect(wrapper.find(".crumb-here").text()).toBe("Evernote");
    // The room has no conversations yet, so the level offers its own door,
    // named for the room rather than the level's core label.
    expect(wrapper.text()).toContain("Nothing running in here yet");
    expect(wrapper.text()).toContain("Ask for something in Evernote's chat");

    await wrapper.find("button.crumb").trigger("click");
    await flushPromises();
    expect(wrapper.find("button.crumb").exists()).toBe(false);
  });
});
