// The one home for in-app `vynel://` deep links. Assistant markdown renders
// them as ordinary anchors (MarkdownText allows the scheme); this router
// intercepts their clicks anywhere in the app via one capture-phase document
// listener — no per-surface wiring, and v-html content couldn't carry Vue
// handlers anyway. AppShell installs it once.
//
// Supported links:
//   vynel://plan/<planId>  → opens the shared PlanViewDialog (ui-store).

import { onBeforeUnmount, onMounted } from "vue";
import { useUiStore } from "../stores/ui-store.js";

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
  }

  onMounted(() =>
    document.addEventListener("click", onDocumentClick, { capture: true }),
  );
  onBeforeUnmount(() =>
    document.removeEventListener("click", onDocumentClick, { capture: true }),
  );
}
