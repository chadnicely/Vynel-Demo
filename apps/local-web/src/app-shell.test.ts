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

// A complete pending-approval row (the notifier renders what the presence
// derivation counts, so the fake must satisfy both).
function makePendingApproval(workspaceId: string | null) {
  return {
    id: `approval-${workspaceId ?? "global"}`,
    providerApprovalId: "prov-1",
    workspaceId,
    sessionId: "session-1",
    parentMessageId: "message-1",
    toolUseId: "tool-use-1",
    toolName: "Bash",
    actionKind: "execute",
    toolInput: { command: "echo hi" },
    status: "pending",
    resolutionKind: null,
    autoApprovedByRuleId: null,
    requestedAt: "2026-08-14T10:00:00.000Z",
    resolvedAt: null,
  };
}

// The shell touches the approvals + workspaces surfaces at mount (notifier,
// titlebar presence) — give it a quiet fake client instead of the network.
function makeFakeVynelClient(
  workspaces: (typeof DEMO_WORKSPACE)[] = [],
  pendingApprovals: ReturnType<typeof makePendingApproval>[] = [],
): VynelClient {
  const noConversation = async () => ({
    rootSessionId: null,
    currentSdkSessionId: null,
  });
  return {
    // The activity feed opens one long-lived SSE request at mount — park it
    // forever (no frames, no reconnect churn) so shell tests stay quiet.
    GET: () => new Promise(() => {}),
    approvals: { listPending: async () => pendingApprovals },
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
  {
    settleRouterBeforeMount = true,
    pendingApprovals = [] as ReturnType<typeof makePendingApproval>[],
  } = {},
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
      provide: {
        [vynelClientKey as symbol]: makeFakeVynelClient(
          workspaces,
          pendingApprovals,
        ),
      },
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

  // SPEC CHANGE (2026-07-26): the browser view is PARKED — the old test drove
  // the title bar's globe toggle into browser mode. Both doors are gone, so
  // what's pinned now is that the view is unreachable and the shell keeps its
  // full chrome. (The panel/store implementation stays tested on its own.)
  it("the parked browser view has no door in the shell", async () => {
    const { wrapper } = await mountShell();

    expect(wrapper.find('[aria-label="Toggle browser view"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Browser view"]').exists()).toBe(false);
    expect(stripTabNames(wrapper)).toEqual(["Global"]);
    expect(menuItems(wrapper).length).toBeGreaterThan(0);
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

  // ── The tabs/menu navigation modes (workspace redesign Arc 2a): one tab
  // state, two presentations. Menu mode collapses the strip and roots the
  // sidebar at the workspace tree; drilling opens the scope's section menu. ──

  it("switching to menu mode hides the strip and shows the workspace tree", async () => {
    const { wrapper } = await mountShell("/", [DEMO_WORKSPACE]);

    await wrapper.find('[title="Menu navigation"]').trigger("click");
    await flushPromises();

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    const treeLabels = wrapper
      .findAll("nav ul button .truncate")
      .map((node) => node.text());
    expect(treeLabels).toContain("Global");
    expect(treeLabels).toContain("Marketing");
    // The pick persists like the theme does.
    expect(localStorage.getItem("vynel.nav-mode")).toBe("menu");
  });

  it("tree drill opens the scope's menu with a back row; back returns to the tree", async () => {
    const { wrapper, router } = await mountShell("/", [DEMO_WORKSPACE]);

    await wrapper.find('[title="Menu navigation"]').trigger("click");
    await flushPromises();

    await wrapper
      .find('[aria-label="Open the Marketing menu"]')
      .trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();

    // Drilled: the room's section menu, led by the trio, with the back row.
    expect(router.currentRoute.value.name).toBe("workspace");
    expect(
      menuItems(wrapper)
        .slice(0, 3)
        .map((button) => button.text()),
    ).toEqual(["Home", "Chat", "Sessions"]);
    const back = wrapper
      .findAll("button")
      .find((button) => button.text() === "Workspaces");
    expect(back).toBeTruthy();

    await back!.trigger("click");
    await flushPromises();

    // Back at the tree, the active room still marked.
    const activeRow = wrapper.find('nav ul button[aria-current="page"]');
    expect(activeRow.text()).toContain("Marketing");
  });

  it("flipping back to tabs keeps the tree-opened room's tab and place", async () => {
    const { wrapper, router } = await mountShell("/", [DEMO_WORKSPACE]);

    await wrapper.find('[title="Menu navigation"]').trigger("click");
    await flushPromises();
    const marketingRow = wrapper
      .findAll("nav ul button")
      .find((button) => button.text().includes("Marketing"));
    await marketingRow!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();

    await wrapper.find('[title="Tabs navigation"]').trigger("click");
    await flushPromises();

    // The room opened from the tree IS a strip tab — one state, two views.
    expect(stripTabNames(wrapper)).toEqual(["Global", "Marketing"]);
    expect(
      wrapper.find('[role="tab"][aria-selected="true"] .truncate').text(),
    ).toBe("Marketing");
    expect(router.currentRoute.value.name).toBe("workspace");
  });

  it("pending approvals light the needs-input dot on their scope only", async () => {
    const { wrapper } = await mountShell("/", [DEMO_WORKSPACE], {
      pendingApprovals: [
        makePendingApproval("ws-marketing"),
        makePendingApproval(null),
      ],
    });

    // Tabs mode: only the Global tab exists on the strip at boot — the
    // null-scoped approval lights ITS dot (the room's tab isn't open yet).
    expect(
      wrapper.find('[aria-label="Global is waiting on you"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[aria-label="Marketing is waiting on you"]').exists(),
    ).toBe(false);

    await wrapper.find('[title="Menu navigation"]').trigger("click");
    await flushPromises();

    // The tree shows the same presence: room dot + the Global row's dot.
    expect(
      wrapper.find('[aria-label="Marketing is waiting on you"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[aria-label="Waiting on you"]').exists()).toBe(true);
  });

  it("selecting a tree row switches scope and stays on the tree", async () => {
    const { wrapper, router } = await mountShell("/", [DEMO_WORKSPACE]);

    await wrapper.find('[title="Menu navigation"]').trigger("click");
    await flushPromises();

    const marketingRow = wrapper
      .findAll("nav ul button")
      .find((button) => button.text().includes("Marketing"));
    await marketingRow!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("workspace");
    // Still the tree (select is not drill) — Global row remains visible.
    const treeLabels = wrapper
      .findAll("nav ul button .truncate")
      .map((node) => node.text());
    expect(treeLabels).toContain("Global");
  });
});
