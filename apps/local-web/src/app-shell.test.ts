import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { createAppRouter } from "./router.js";
import { vynelClientKey } from "./plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";

// One workspace row, complete enough for the strip, sidebar, and room view
// (the welcome hero reads `kind` through WORKSPACE_KIND_BUNDLES).
const DEMO_WORKSPACE = {
  id: "ws-marketing",
  name: "Marketing",
  kind: "project",
  managerName: "Sage",
  isArchived: false,
};

// The shell touches the approvals + workspaces surfaces at mount (notifier,
// titlebar presence) — give it a quiet fake client instead of the network.
function makeFakeVynelClient(
  workspaces: (typeof DEMO_WORKSPACE)[] = [],
): VynelClient {
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
    workspaces: { list: async () => workspaces },
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

async function mountShell(
  initialPath = "/",
  workspaces: (typeof DEMO_WORKSPACE)[] = [],
  // Production (main.ts) mounts WITHOUT awaiting router.isReady() — the shell
  // sees the START location first and the router resolves the browser URL as
  // its initial navigation. Cold-start tests mirror that ordering exactly:
  // stamp the URL, mount, no push (jsdom shares one window.history, so an
  // unawaited push would race the router's own initial navigation).
  { settleRouterBeforeMount = true } = {},
) {
  window.history.replaceState(null, "", initialPath);
  const router = createAppRouter();
  if (settleRouterBeforeMount) {
    await router.push(initialPath);
    await router.isReady();
  }
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
      provide: { [vynelClientKey as symbol]: makeFakeVynelClient(workspaces) },
    },
  });
  await router.isReady();
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

/** The strip's visible tab names — the label spans, without the monograms. */
function stripTabNames(
  wrapper: Awaited<ReturnType<typeof mountShell>>["wrapper"],
) {
  return wrapper
    .findAll('[role="tab"]')
    .map((tab) => tab.find(".truncate").text());
}

describe("app shell", () => {
  // The scope-tab strip persists in localStorage — every mount must start
  // from a clean slate or tabs leak between tests.
  beforeEach(() => {
    localStorage.clear();
  });

  // The shell was reinvented into a desktop layout: Home / Chat / Sessions are
  // ORDINARY sidebar menu items at the top of the one list — no pill toggle.
  // A room is entered via the SCOPE TAB STRIP below the title bar (test:
  // correct expectation — the strip is a real tablist now; the dead assertion
  // pinned the old segmented pill's absence, which the menu items still cover).
  it("redirects / to Home; the strip leads with Global; the menu leads with the trio", async () => {
    const { wrapper, router } = await mountShell();

    expect(router.currentRoute.value.name).toBe("home");
    expect(stripTabNames(wrapper)).toEqual(["Global"]);
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

  // test: correct expectation — scope now lives on the TAB STRIP. A /workspace
  // deep link with no workspace tab open has no room to show; it falls back to
  // the global chat instead of rendering a dead room. Mounted in PRODUCTION
  // ordering (before the router settles) — the reconcile must not race
  // router.isReady().
  it("deep-linking /workspace with no workspace tab falls back to the global chat", async () => {
    const { wrapper, router } = await mountShell("/workspace", [], {
      settleRouterBeforeMount: false,
    });
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("chat");
    expect(currentMenuItems(wrapper).map((button) => button.text())).toEqual([
      "Chat",
    ]);
  });

  // Cold start always lands on a global place (/ → /home) — a restored active
  // WORKSPACE tab must hand scope back to the Global tab (the URL wins), never
  // render Home's canvas against a workspace sidebar.
  it("cold-starting at / with a restored workspace tab returns scope to Global", async () => {
    localStorage.setItem(
      "vynel.tabs",
      JSON.stringify({
        tabs: [
          { id: "global", workspaceId: null },
          { id: "tab-1", workspaceId: DEMO_WORKSPACE.id },
        ],
        activeTabId: "tab-1",
      }),
    );
    const { wrapper, router } = await mountShell("/", [DEMO_WORKSPACE], {
      settleRouterBeforeMount: false,
    });
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("home");
    // The workspace tab survives on the strip; the sidebar is the GLOBAL menu
    // ("Application" only exists there).
    expect(stripTabNames(wrapper)).toEqual(["Global", "Marketing"]);
    expect(menuItem(wrapper, "Application")).toBeDefined();
  });

  it("switching tabs restores each tab's last route", async () => {
    localStorage.setItem(
      "vynel.tabs",
      JSON.stringify({
        tabs: [
          { id: "global", workspaceId: null },
          { id: "tab-1", workspaceId: DEMO_WORKSPACE.id },
        ],
        activeTabId: "tab-1",
      }),
    );
    const { wrapper, router } = await mountShell("/workspace", [
      DEMO_WORKSPACE,
    ]);
    await vi.dynamicImportSettled();
    await flushPromises();

    // Park the room tab on its scoped session library…
    await menuItem(wrapper, "Sessions")!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(router.currentRoute.value.query.workspace).toBe(DEMO_WORKSPACE.id);

    // …hop to the Global tab (its default place, the chat)…
    await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("chat");

    // …and returning to the room tab restores the library, not the default.
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("sessions");
    expect(router.currentRoute.value.query.workspace).toBe(DEMO_WORKSPACE.id);
  });

  // A persisted workspace tab restores the room: its tab on the strip, the
  // room's sidebar sections, and the room-scoped session library.
  it("a workspace tab shows the room — strip name, Chat marked, scoped Sessions", async () => {
    localStorage.setItem(
      "vynel.tabs",
      JSON.stringify({
        tabs: [
          { id: "global", workspaceId: null },
          { id: "tab-1", workspaceId: DEMO_WORKSPACE.id },
        ],
        activeTabId: "tab-1",
      }),
    );
    const { wrapper, router } = await mountShell("/workspace", [
      DEMO_WORKSPACE,
    ]);
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(stripTabNames(wrapper)).toEqual(["Global", "Marketing"]);
    expect(currentMenuItems(wrapper).map((button) => button.text())).toEqual([
      "Chat",
    ]);
    expect(
      menuItems(wrapper)
        .slice(0, 3)
        .map((button) => button.text()),
    ).toEqual(["Home", "Chat", "Sessions"]);

    await menuItem(wrapper, "Sessions")!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("sessions");
    expect(router.currentRoute.value.query.workspace).toBe(DEMO_WORKSPACE.id);
  });

  // Browser mode is a focus takeover: chat left, page right, chrome gone —
  // and closing restores every piece.
  it("browser mode tucks the chrome away and restores it on close", async () => {
    const { wrapper, router } = await mountShell();

    await wrapper.find('[aria-label="Toggle browser view"]').trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("chat");
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(menuItems(wrapper)).toHaveLength(0);
    expect(wrapper.find('[aria-label="Browser view"]').exists()).toBe(true);

    await wrapper.find('[aria-label="Close browser view"]').trigger("click");
    await flushPromises();

    expect(stripTabNames(wrapper)).toEqual(["Global"]);
    expect(menuItems(wrapper).length).toBeGreaterThan(0);
    expect(wrapper.find('[aria-label="Browser view"]').exists()).toBe(false);
  });

  it("closing the room's tab returns to the Global tab and its chat", async () => {
    localStorage.setItem(
      "vynel.tabs",
      JSON.stringify({
        tabs: [
          { id: "global", workspaceId: null },
          { id: "tab-1", workspaceId: DEMO_WORKSPACE.id },
        ],
        activeTabId: "tab-1",
      }),
    );
    const { wrapper, router } = await mountShell("/workspace", [
      DEMO_WORKSPACE,
    ]);
    await vi.dynamicImportSettled();
    await flushPromises();

    await wrapper.find('[aria-label="Close Marketing"]').trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(stripTabNames(wrapper)).toEqual(["Global"]);
    expect(router.currentRoute.value.name).toBe("chat");
  });
});
