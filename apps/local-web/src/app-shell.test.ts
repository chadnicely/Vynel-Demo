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
    // The Sessions view reads the cross-scope overview.
    sessions: { overview: async () => [] },
    chat: {
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

/** The sidebar's plain menu rows (the segmented pill died — Chad's "no
 *  special menus"): Home / Chat / Sessions lead the one list. */
function menuItems(wrapper: Awaited<ReturnType<typeof mountShell>>["wrapper"]) {
  return wrapper.findAll("nav ul button");
}

function menuItem(
  wrapper: Awaited<ReturnType<typeof mountShell>>["wrapper"],
  label: string,
) {
  return menuItems(wrapper).find((button) => button.text() === label);
}

function currentMenuItems(
  wrapper: Awaited<ReturnType<typeof mountShell>>["wrapper"],
) {
  return menuItems(wrapper).filter(
    (button) => button.attributes("aria-current") === "page",
  );
}

describe("app shell", () => {
  // The shell was reinvented into a desktop layout: Home / Chat / Sessions are
  // ORDINARY sidebar menu items at the top of the one list — no pill toggle,
  // no "Workspace" tab (a room is entered via the title-bar switcher).
  it("redirects / to Home; the menu leads with Home, Chat, Sessions as plain items", async () => {
    const { wrapper, router } = await mountShell();

    expect(router.currentRoute.value.name).toBe("home");
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(
      menuItems(wrapper)
        .slice(0, 3)
        .map((button) => button.text()),
    ).toEqual(["Home", "Chat", "Sessions"]);
    expect(wrapper.text()).toContain(
      "everything your assistant does shows up here",
    );
  });

  it("clicking the Chat menu item swaps the routed view", async () => {
    const { wrapper, router } = await mountShell();

    await menuItem(wrapper, "Chat")!.trigger("click");
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

  it("clicking the Sessions menu item routes to the session library", async () => {
    const { wrapper, router } = await mountShell();

    await menuItem(wrapper, "Sessions")!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("sessions");
    // Global scope carries no workspace query — the library lists everything.
    expect(router.currentRoute.value.query.workspace).toBeUndefined();
    expect(wrapper.text()).toContain("No conversations yet");
  });

  it("marks the menu row for the current surface — Home, Chat, Sessions", async () => {
    const home = await mountShell("/home");
    expect(currentMenuItems(home.wrapper).map((b) => b.text())).toEqual([
      "Home",
    ]);

    const chat = await mountShell("/chat");
    expect(currentMenuItems(chat.wrapper).map((b) => b.text())).toEqual([
      "Chat",
    ]);

    const sessions = await mountShell("/sessions");
    expect(currentMenuItems(sessions.wrapper).map((b) => b.text())).toEqual([
      "Sessions",
    ]);
  });

  // test: correct expectation — Chat follows the scope now (Chad, 2026-07-21):
  // a workspace thread marks the Chat row (was: nothing, when the row led to
  // the global thread).
  it("marks the Chat row inside a workspace thread (Chat follows the scope)", async () => {
    const { wrapper } = await mountShell("/workspace");

    expect(currentMenuItems(wrapper).map((button) => button.text())).toEqual(["Chat"]);
  });

  it("the trio still leads the menu inside a workspace, and Sessions opens the room's library", async () => {
    const { wrapper, router } = await mountShell("/workspace");

    expect(
      menuItems(wrapper)
        .slice(0, 3)
        .map((button) => button.text()),
    ).toEqual(["Home", "Chat", "Sessions"]);

    // No workspace exists in this harness (empty list), so the scope resolves
    // global — the point pinned here is the ROUTING, per-scope filtering is
    // pinned in sessions-view.test.ts.
    await menuItem(wrapper, "Sessions")!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("sessions");
  });
});
