import { toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
import type { ShellTab } from "../../stores/ui-store.js";

/** The scope-tab lifecycle for the shell: the store mutates, and every route
 *  change that follows a tab switch lives HERE — one home, so every path that
 *  activates a tab restores that tab's place the same way. */
export function useScopeTabs(
  workspaceRows: MaybeRefOrGetter<{ id: string }[]>,
  isWorkspaceListLoaded: MaybeRefOrGetter<boolean>,
) {
  const route = useRoute();
  const router = useRouter();
  const ui = useUiStore();

  function isWorkspaceRoute(): boolean {
    return (
      route.name === "workspace" ||
      (route.name === "sessions" && typeof route.query.workspace === "string")
    );
  }

  function navigateToTab(tab: ShellTab) {
    if (tab.lastRoutePath !== null) {
      void router.push(tab.lastRoutePath);
      return;
    }
    void router.push({ name: tab.workspaceId === null ? "chat" : "workspace" });
  }

  function selectTab(tabId: string) {
    if (tabId === ui.activeTabId) return;
    ui.activateTab(tabId);
    navigateToTab(ui.activeTab);
  }

  function closeTab(tabId: string) {
    const wasActive = tabId === ui.activeTabId;
    ui.closeTab(tabId);
    if (wasActive) navigateToTab(ui.activeTab);
  }

  function addTab(workspaceId: string) {
    ui.addWorkspaceTab(workspaceId);
    void router.push({ name: "workspace" });
  }

  function retargetTab(tabId: string, workspaceId: string) {
    ui.retargetTab(tabId, workspaceId);
    if (tabId === ui.activeTabId) void router.push({ name: "workspace" });
  }

  // Each tab remembers where it is, so switching back restores its place.
  // Only routes that belong to the tab's scope record — the router's START
  // location (name null) and transient mismatches mid-reconcile must not
  // teach a tab a foreign route.
  watch(
    () => route.fullPath,
    () => {
      if (route.name == null) return;
      if (isWorkspaceRoute() !== (ui.activeTab.workspaceId !== null)) return;
      ui.activeTab.lastRoutePath = route.fullPath;
    },
    { immediate: true },
  );

  // Boot reconcile — THE URL WINS. Runs after the router settles its initial
  // navigation (at cold start the shell mounts while the router is still at
  // START, where route.name is undefined — a setup-time check would silently
  // skip). A workspace route with no room activates one (the sessions query
  // names it; /workspace takes any open room, else falls back to the global
  // chat); a global route with a restored workspace tab returns to Global.
  void router.isReady().then(() => {
    const inWorkspaceScope = ui.activeTab.workspaceId !== null;
    if (isWorkspaceRoute() && !inWorkspaceScope) {
      const sessionsWorkspaceId =
        route.name === "sessions" && typeof route.query.workspace === "string"
          ? route.query.workspace
          : null;
      if (sessionsWorkspaceId !== null) {
        ui.openWorkspaceTab(sessionsWorkspaceId);
        return;
      }
      const workspaceTab = ui.tabs.find((tab) => tab.workspaceId !== null);
      if (workspaceTab !== undefined) ui.activateTab(workspaceTab.id);
      else void router.replace({ name: "chat" });
    } else if (!isWorkspaceRoute() && inWorkspaceScope) {
      ui.activateTab(GLOBAL_TAB_ID);
    }
  });

  // A deleted workspace takes its tabs with it once the list loads — the
  // strip never shows a room that would 404.
  watch(
    [() => toValue(workspaceRows), () => toValue(isWorkspaceListLoaded)] as const,
    ([rows, loaded]) => {
      if (!loaded) return;
      const activeBefore = ui.activeTabId;
      ui.pruneWorkspaceTabs(rows.map((row) => row.id));
      if (ui.activeTabId !== activeBefore) navigateToTab(ui.activeTab);
    },
    { immediate: true },
  );

  return { selectTab, closeTab, addTab, retargetTab };
}
