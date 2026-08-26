// The one home for in-app `vynel://` deep links. Assistant markdown renders
// them as ordinary anchors (MarkdownText allows the scheme); this router
// intercepts their clicks anywhere in the app via one capture-phase document
// listener — no per-surface wiring, and v-html content couldn't carry Vue
// handlers anyway. AppShell installs it once.
//
// Supported links:
//   vynel://plan/<planId>       → opens the shared PlanViewDialog (ui-store).
//   vynel://file/<encoded path> → opens the file in its room's editor: the
//                                 room whose folder holds it (an absolute
//                                 path), or the room on screen (a relative
//                                 one). A file outside every room opens
//                                 nothing — the files API is room-scoped.

import { onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import { filePathFromAppLink } from "@vynel/ui";
import { useUiStore } from "../stores/ui-store.js";
import { useWorkspaceList } from "./workspaces/use-workspace-list.js";
import { resolveFileLinkTarget } from "./files/file-link-target.js";

export const PLAN_LINK_PREFIX = "vynel://plan/";

// Scheme matching is case-INsensitive (DOMPurify admits `VYNEL://` too); the
// id itself keeps its case.
export function planIdFromAppLink(href: string): string | null {
  if (!href.toLowerCase().startsWith(PLAN_LINK_PREFIX)) return null;
  const planId = href.slice(PLAN_LINK_PREFIX.length);
  return planId.length > 0 ? planId : null;
}

export function useAppLinkRouter() {
  const ui = useUiStore();
  const router = useRouter();
  const workspacesQuery = useWorkspaceList();

  function openFile(linkedPath: string) {
    const target = resolveFileLinkTarget(linkedPath, {
      workspaces: workspacesQuery.data.value ?? [],
      activeWorkspaceId: ui.activeTab.workspaceId,
    });
    if (target === null) return;
    // The room's tab (opened or reused) lands on the file; the route follows
    // so a click from Home or the Sessions library still shows it.
    const tab = ui.openWorkspaceTab(target.workspaceId);
    tab.shell.mainView = { kind: "file", filePath: target.relativePath };
    void router.push({ name: "workspace" });
  }

  function onDocumentClick(event: MouseEvent) {
    const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.toLowerCase().startsWith("vynel://")) return;
    // Ours — never let the browser/Electron try to navigate the scheme.
    event.preventDefault();
    event.stopPropagation();
    const planId = planIdFromAppLink(href);
    if (planId) ui.viewingPlanId = planId;
    const filePath = filePathFromAppLink(href);
    if (filePath) openFile(filePath);
  }

  onMounted(() =>
    document.addEventListener("click", onDocumentClick, { capture: true }),
  );
  onBeforeUnmount(() =>
    document.removeEventListener("click", onDocumentClick, { capture: true }),
  );
}
