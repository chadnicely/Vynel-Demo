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
    approvals: { listPending: async () => [] },
    workspaces: { list: async () => [] },
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
    dashboard: {
      getOverview: async () => ({
        workspaces: [],
        recentSessions: [],
        upcomingSchedules: [],
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
  it("redirects / to Home and renders the three tabs", async () => {
    const { wrapper, router } = await mountShell();

    expect(router.currentRoute.value.name).toBe("home");
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map((tab) => tab.text())).toEqual([
      "Home",
      "Chat",
      "Workspace",
    ]);
    expect(wrapper.text()).toContain(
      "everything your assistant does shows up here",
    );
  });

  it("clicking a tab swaps the routed view", async () => {
    const { wrapper, router } = await mountShell();

    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    // The navigation lazy-loads the view chunk — settle the dynamic import first.
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("chat");
    expect(wrapper.text()).toContain("Your assistant is ready");
  });

  it("marks the tab of the current route as selected", async () => {
    const { wrapper } = await mountShell("/workspace");

    const selected = wrapper
      .findAll('[role="tab"]')
      .filter((tab) => tab.attributes("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.text()).toBe("Workspace");
  });
});
