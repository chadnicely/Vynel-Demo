import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { createAppRouter } from "./router.js";
import { vynelClientKey } from "./plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";

// The shell touches the approvals + workspaces surfaces at mount (notifier,
// titlebar presence) — give it a quiet fake client instead of the network.
function makeFakeVynelClient(): VynelClient {
  const noConversation = async () => ({
    rootSessionId: null,
    currentSdkSessionId: null,
  });
  return {
    // The activity feed opens one long-lived SSE request at mount — park it
    // forever (no frames, no reconnect churn) so shell tests stay quiet.
    GET: () => new Promise(() => {}),
    approvals: { listPending: async () => [] },
    // The ask notifier polls alongside approvals from the shell.
    asks: { listPending: async () => [] },
    workspaces: { list: async () => [] },
    channelsUser: { list: async () => [] },
    // The shell reads the tasks list for the title-bar badge.
    tasksUser: { list: async () => [] },
    chat: {
      listSessions: async () => [],
      getContinuing: noConversation,
      getSession: async () => {
        throw new Error("not in this test");
      },
    },
    root: {
      getContinuing: noConversation,
      getSession: async () => {
        throw new Error("not in this test");
      },
      listDelegations: async () => ({ delegations: [] }),
    },
    users: {
      getMe: async () => ({
        id: "u1",
        displayName: "Sam Lee",
        emailAddress: null,
        locale: "en-US",
        timezone: "UTC",
        hasCompletedOnboarding: true,
        createdAt: "2026-07-05T10:00:00.000Z",
        updatedAt: "2026-07-05T10:00:00.000Z",
      }),
    },
    dashboard: {
      getOverview: async () => ({
        workspaces: [],
        recentSessions: [],
        upcomingSchedules: [],
        openTasks: [],
        recentlyCompletedTasks: [],
      }),
    },
  } as unknown as VynelClient;
}

async function mountShell(initialPath = "/") {
  const router = createAppRouter();
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(App, {
    global: {
      plugins: [
        router,
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
      provide: { [vynelClientKey as symbol]: makeFakeVynelClient() },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("app shell", () => {
  // The shell was reinvented into a desktop layout: the sidebar carries a
  // Home/Chat mode toggle (no "Workspace" tab — a room is entered via the
  // title-bar workspace switcher). These tests track that model.
  it("redirects / to Home and shows the Home/Chat toggle", async () => {
    const { wrapper, router } = await mountShell();

    expect(router.currentRoute.value.name).toBe("home");
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map((tab) => tab.text())).toEqual(["Home", "Chat"]);
    expect(wrapper.text()).toContain(
      "everything your assistant does shows up here",
    );
  });

  it("clicking the Chat toggle swaps the routed view", async () => {
    const { wrapper, router } = await mountShell();

    const chatTab = wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "Chat");
    await chatTab!.trigger("click");
    // The navigation lazy-loads the view chunk — settle the dynamic import first.
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("chat");
    // The welcome hero: the assistant presents itself by name, greets the
    // user, and lays out its command deck.
    expect(wrapper.text()).toContain("Claude");
    expect(wrapper.text()).toMatch(
      /(Good (morning|afternoon|evening)|Up late), Sam\./,
    );
    expect(wrapper.text()).toContain("Reachable on");
  });

  it("marks the toggle for the current global surface", async () => {
    const { wrapper } = await mountShell("/chat");

    const selected = wrapper
      .findAll('[role="tab"]')
      .filter((tab) => tab.attributes("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.text()).toBe("Chat");
  });

  it("selects neither toggle inside a workspace (the switcher carries the scope)", async () => {
    const { wrapper } = await mountShell("/workspace");

    const selected = wrapper
      .findAll('[role="tab"]')
      .filter((tab) => tab.attributes("aria-selected") === "true");
    expect(selected).toHaveLength(0);
  });
});
