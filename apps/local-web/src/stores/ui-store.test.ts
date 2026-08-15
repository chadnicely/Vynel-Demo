import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { GLOBAL_TAB_ID, useUiStore } from "./ui-store.js";

describe("ui-store theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "";
    setActivePinia(createPinia());
  });

  it("defaults to dark and stamps it on the document", () => {
    const ui = useUiStore();

    expect(ui.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggle flips the theme, the document attribute, and persists", () => {
    const ui = useUiStore();

    ui.toggleTheme();

    expect(ui.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("vynel.theme")).toBe("light");
  });

  it("restores a persisted theme on a fresh store", () => {
    localStorage.setItem("vynel.theme", "light");

    const ui = useUiStore();

    expect(ui.theme).toBe("light");
  });
});

// test: the single active-workspace selection became the scope tab strip —
// the pinned Global tab plus workspace tabs, each with its own canvas shell.
describe("ui-store scope tabs", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("starts with only the pinned Global tab active", () => {
    const ui = useUiStore();

    expect(ui.tabs.map((tab) => tab.workspaceId)).toEqual([null]);
    expect(ui.activeTabId).toBe(GLOBAL_TAB_ID);
    expect(ui.activeWorkspaceId).toBeNull();
  });

  it("adds a workspace tab, activates it, and persists the strip", async () => {
    const ui = useUiStore();

    const tab = ui.addWorkspaceTab("ws-marketing");
    await nextTick();

    expect(ui.activeTabId).toBe(tab.id);
    expect(ui.activeWorkspaceId).toBe("ws-marketing");
    const stored = JSON.parse(localStorage.getItem("vynel.tabs")!) as {
      tabs: { workspaceId: string | null }[];
      activeTabId: string;
    };
    expect(stored.tabs.map((row) => row.workspaceId)).toEqual([
      null,
      "ws-marketing",
    ]);
    expect(stored.activeTabId).toBe(tab.id);
  });

  it("restores the persisted strip on a fresh store", async () => {
    const ui = useUiStore();
    const tab = ui.addWorkspaceTab("ws-marketing");
    await nextTick();

    setActivePinia(createPinia());
    const restored = useUiStore();

    expect(restored.tabs.map((row) => row.workspaceId)).toEqual([
      null,
      "ws-marketing",
    ]);
    expect(restored.activeTabId).toBe(tab.id);
  });

  it("falls back to the lone Global tab on junk storage", () => {
    localStorage.setItem("vynel.tabs", "{not json");

    const ui = useUiStore();

    expect(ui.tabs.map((tab) => tab.workspaceId)).toEqual([null]);
    expect(ui.activeTabId).toBe(GLOBAL_TAB_ID);
  });

  it("migrates the legacy active-workspace key into a workspace tab, once", () => {
    localStorage.setItem("vynel.active-workspace", "demo-ws-marketing");

    const ui = useUiStore();

    expect(ui.activeWorkspaceId).toBe("demo-ws-marketing");
    expect(ui.tabs).toHaveLength(2);
    expect(localStorage.getItem("vynel.active-workspace")).toBeNull();
  });

  it("a migrated strip survives an immediate reload (write-through persist)", () => {
    localStorage.setItem("vynel.active-workspace", "demo-ws-marketing");
    useUiStore();

    // Reload with no structural change in between — the legacy key is already
    // deleted, so only the write-through keeps the migrated tab alive.
    setActivePinia(createPinia());
    const restored = useUiStore();

    expect(restored.activeWorkspaceId).toBe("demo-ws-marketing");
    expect(restored.tabs).toHaveLength(2);
  });

  it("never closes the Global tab", () => {
    const ui = useUiStore();

    ui.closeTab(GLOBAL_TAB_ID);

    expect(ui.tabs).toHaveLength(1);
  });

  it("closing the active tab hands focus to its right neighbor, else left", () => {
    const ui = useUiStore();
    const first = ui.addWorkspaceTab("ws-a");
    const second = ui.addWorkspaceTab("ws-b");

    ui.activateTab(first.id);
    ui.closeTab(first.id);
    expect(ui.activeTabId).toBe(second.id);

    ui.closeTab(second.id);
    expect(ui.activeTabId).toBe(GLOBAL_TAB_ID);
  });

  it("closing an inactive tab keeps the active one", () => {
    const ui = useUiStore();
    const first = ui.addWorkspaceTab("ws-a");
    const second = ui.addWorkspaceTab("ws-b");

    ui.activateTab(second.id);
    ui.closeTab(first.id);

    expect(ui.activeTabId).toBe(second.id);
  });

  it("retargeting a tab points it at the new room's continuous chat", () => {
    const ui = useUiStore();
    const tab = ui.addWorkspaceTab("ws-a");
    tab.shell.mainView = "knowledge";
    tab.shell.target = "fresh";
    ui.setTabColor(tab.id, 2);

    ui.retargetTab(tab.id, "ws-b");

    expect(tab.workspaceId).toBe("ws-b");
    expect(tab.shell.mainView).toBe("chat");
    expect(tab.shell.target).toBe("continuous");
    // The color belongs to the TAB, not the room — it rides along.
    expect(tab.colorSlot).toBe(2);
  });

  it("a picked tab color persists and restores; junk stored slots fail to auto", async () => {
    const ui = useUiStore();
    const tab = ui.addWorkspaceTab("ws-a");

    ui.setTabColor(tab.id, 3);
    await nextTick();

    setActivePinia(createPinia());
    const restored = useUiStore();
    expect(restored.tabs[1]!.colorSlot).toBe(3);

    // A slot outside the palette (a downgraded build, hand-edited storage)
    // must not render a broken var() — it falls back to auto. A pre-color
    // strip (no colorSlot key at all — the shipped v1 shape) restores as
    // auto the same way.
    localStorage.setItem(
      "vynel.tabs",
      JSON.stringify({
        tabs: [
          { id: "global", workspaceId: null },
          { id: "t1", workspaceId: "ws-a", colorSlot: 99 },
          { id: "t2", workspaceId: "ws-b" },
        ],
        activeTabId: "t1",
      }),
    );
    setActivePinia(createPinia());
    const reread = useUiStore();
    expect(reread.tabs[1]!.colorSlot).toBeNull();
    expect(reread.tabs[2]!.colorSlot).toBeNull();
    expect(reread.tabs[2]!.workspaceId).toBe("ws-b");
  });

  it("the Global tab refuses a color — its mark stays neutral", () => {
    const ui = useUiStore();

    ui.setTabColor(GLOBAL_TAB_ID, 3);

    expect(ui.globalTab.colorSlot).toBeNull();
  });

  it("re-picking the tab's own room is a no-op — its place stays put", () => {
    const ui = useUiStore();
    const tab = ui.addWorkspaceTab("ws-a");
    tab.shell.mainView = "knowledge";
    tab.lastRoutePath = "/sessions?workspace=ws-a";

    ui.retargetTab(tab.id, "ws-a");

    expect(tab.shell.mainView).toBe("knowledge");
    expect(tab.lastRoutePath).toBe("/sessions?workspace=ws-a");
  });

  it("openWorkspaceTab focuses an existing tab for the room, else opens one", () => {
    const ui = useUiStore();
    const existing = ui.addWorkspaceTab("ws-a");
    ui.activateTab(GLOBAL_TAB_ID);

    expect(ui.openWorkspaceTab("ws-a").id).toBe(existing.id);
    expect(ui.activeTabId).toBe(existing.id);

    const opened = ui.openWorkspaceTab("ws-b");
    expect(opened.id).not.toBe(existing.id);
    expect(ui.tabs).toHaveLength(3);
  });

  it("openWorkspaceTab keeps the tab's conversation target (a switch-away must not lose the thread)", () => {
    const ui = useUiStore();
    const tab = ui.addWorkspaceTab("ws-a");
    tab.shell.target = { sessionId: "session-1" };
    tab.shell.mainView = "knowledge";
    ui.activateTab(GLOBAL_TAB_ID);

    ui.openWorkspaceTab("ws-a");

    // Lands on chat, but the conversation the user was in stays the target.
    expect(tab.shell.mainView).toBe("chat");
    expect(tab.shell.target).toEqual({ sessionId: "session-1" });
  });

  it("prunes tabs whose workspace no longer exists and refocuses Global", () => {
    const ui = useUiStore();
    ui.addWorkspaceTab("ws-kept");
    const stale = ui.addWorkspaceTab("ws-deleted");
    ui.activateTab(stale.id);

    ui.pruneWorkspaceTabs(["ws-kept"]);

    expect(ui.tabs.map((tab) => tab.workspaceId)).toEqual([null, "ws-kept"]);
    expect(ui.activeTabId).toBe(GLOBAL_TAB_ID);
  });
});

describe("ui-store composer selections", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("persists the session mode and restores it on a fresh store", async () => {
    const ui = useUiStore();
    ui.composerMode = "bypass";
    await nextTick();
    expect(localStorage.getItem("vynel.composer-mode")).toBe("bypass");

    setActivePinia(createPinia());
    expect(useUiStore().composerMode).toBe("bypass");
  });

  it("falls back to the default for an unknown stored mode or model", () => {
    localStorage.setItem("vynel.composer-mode", "yolo");
    localStorage.setItem("vynel.composer-model", "gpt-99");
    const ui = useUiStore();
    expect(ui.composerMode).toBe("ask");
    expect(ui.composerModelId).toBe("claude-opus-4-8");
  });

  it("keeps a claude-shaped stored model even when the static floor doesn't list it", () => {
    // The roster is DISCOVERED — a newly shipped model the user picked must
    // survive a reload (an allowlist restore would silently discard it).
    localStorage.setItem("vynel.composer-model", "claude-opus-6");
    expect(useUiStore().composerModelId).toBe("claude-opus-6");
  });

  it("persists the model selection", async () => {
    const ui = useUiStore();
    ui.composerModelId = "claude-haiku-4-5";
    await nextTick();
    expect(localStorage.getItem("vynel.composer-model")).toBe("claude-haiku-4-5");

    setActivePinia(createPinia());
    expect(useUiStore().composerModelId).toBe("claude-haiku-4-5");
  });

  it("persists the thinking effort and restores it on a fresh store", async () => {
    const ui = useUiStore();
    // test: correct expectation — 'auto' was removed from the picker
    // (2026-07-30); the default is now an explicit 'high'.
    expect(ui.composerThinkingEffort).toBe("high");

    ui.composerThinkingEffort = "max";
    await nextTick();
    expect(localStorage.getItem("vynel.composer-thinking-effort")).toBe("max");

    setActivePinia(createPinia());
    expect(useUiStore().composerThinkingEffort).toBe("max");
  });

  it("falls back to the default for a stored effort outside the picker catalog", () => {
    // A junk/legacy value (including the retired 'auto') must never reach a
    // turn request — fail closed.
    localStorage.setItem("vynel.composer-thinking-effort", "auto");
    expect(useUiStore().composerThinkingEffort).toBe("high");
  });

  it("keeps the full desktop-parity levels as valid stored choices", () => {
    // test: correct expectation — Chad widened the picker to all five SDK
    // levels (2026-07-21); 'xhigh' moved from fail-closed to valid.
    localStorage.setItem("vynel.composer-thinking-effort", "xhigh");
    expect(useUiStore().composerThinkingEffort).toBe("xhigh");
  });
});

describe("ui-store nodes screen", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("opens on the constellation", () => {
    expect(useUiStore().nodesMode).toBe("nodes");
  });

  it("keeps the chosen reading for the session, and deliberately not past it", () => {
    // It survives leaving the route because the store outlives it — but it is
    // NOT persisted like the theme is (the prototype's own behaviour): a fresh
    // app opens on the constellation again.
    const ui = useUiStore();
    ui.nodesMode = "race";
    expect(useUiStore().nodesMode).toBe("race");

    setActivePinia(createPinia());
    expect(useUiStore().nodesMode).toBe("nodes");
  });

  it("the create-workspace bell counts each ring", () => {
    // A counter, not a boolean: the shell watches it, and two asks in a row
    // must both reach the dialog — a flag would swallow the second.
    const ui = useUiStore();
    expect(ui.createWorkspaceRequestCount).toBe(0);
    ui.requestCreateWorkspace();
    ui.requestCreateWorkspace();
    expect(ui.createWorkspaceRequestCount).toBe(2);
  });
});
