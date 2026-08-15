// The Nodes screen's chrome. The constellation itself is canvas (its data
// mapping is covered in constellation-layout.test.ts) — what this pins is the
// view around it: the invitation appears only on an empty fleet, and its CTA
// reaches the shell's create-workspace dialog through the ui-store bell.

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

async function mountView(workspaces: Array<Record<string, unknown>>) {
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
    const { wrapper, pinia } = await mountView([]);
    const ui = useUiStore(pinia);
    expect(ui.createWorkspaceRequestCount).toBe(0);
    await wrapper.find("button.cta").trigger("click");
    expect(ui.createWorkspaceRequestCount).toBe(1);
  });

  it("with workspaces the invitation gives way to the constellation hint", async () => {
    const { wrapper } = await mountView([makeWorkspace()]);
    expect(wrapper.text()).not.toContain("Nothing in orbit yet");
    expect(wrapper.text()).toContain("click to open it");
  });

  it("an archived room is not a dot — only rooms that can still work orbit", async () => {
    const { wrapper } = await mountView([
      makeWorkspace({ id: "ws-archived", isArchived: true }),
    ]);
    expect(wrapper.text()).toContain("Nothing in orbit yet");
  });
});
