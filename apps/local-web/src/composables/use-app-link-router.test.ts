import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { fileLinkHref } from "@vynel/ui";
import { vynelClientKey } from "../plugins/vynel-client.js";
import { useUiStore } from "../stores/ui-store.js";
import { planIdFromAppLink, useAppLinkRouter } from "./use-app-link-router.js";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

const WORKSPACES = [
  { id: "ws-proj", name: "Proj", path: "C:\\Users\\me\\proj" },
  { id: "ws-site", name: "Site", path: "/home/me/site" },
];

// A host standing in for AppShell: installs the router, renders anchors the
// way sanitized assistant markdown does (plain <a>, no Vue handlers).
const Host = defineComponent({
  setup() {
    useAppLinkRouter();
    return () =>
      h("div", [
        h("a", { href: "vynel://plan/p_1" }, "Launch day"),
        h("a", { href: fileLinkHref("C:\\Users\\me\\proj\\docs\\plan.md") }, "plan.md"),
        h("a", { href: fileLinkHref("src/pricing.ts") }, "pricing.ts"),
        h("a", { href: fileLinkHref("D:\\elsewhere\\notes.md") }, "notes.md"),
        h("a", { href: "https://example.com" }, "outside"),
      ]);
  },
});

function mountHost() {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: Host },
      { path: "/workspace", name: "workspace", component: Host },
    ],
  });
  const list = vi.fn(async () => WORKSPACES);
  const wrapper = mount(Host, {
    global: {
      plugins: [
        pinia,
        router,
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: { workspaces: { list } } },
    },
    attachTo: document.body,
  });
  return { wrapper, router, ui: useUiStore(pinia), list };
}

function click(wrapper: ReturnType<typeof mountHost>["wrapper"], href: string) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  wrapper.get(`a[href="${href}"]`).element.dispatchEvent(event);
  return event;
}

describe("planIdFromAppLink", () => {
  it("parses a plan link and rejects everything else", () => {
    expect(planIdFromAppLink("vynel://plan/p_1")).toBe("p_1");
    expect(planIdFromAppLink("vynel://plan/")).toBeNull();
    expect(planIdFromAppLink("vynel://other/p_1")).toBeNull();
    expect(planIdFromAppLink("https://example.com")).toBeNull();
  });

  it("matches the scheme case-insensitively (DOMPurify admits VYNEL:// too) but keeps the id's case", () => {
    expect(planIdFromAppLink("VYNEL://PLAN/p_Xy")).toBe("p_Xy");
  });
});

describe("useAppLinkRouter", () => {
  it("intercepts a vynel://plan click: opens the shared viewer, never navigates", async () => {
    const { wrapper, ui } = mountHost();

    const event = click(wrapper, "vynel://plan/p_1");

    expect(ui.viewingPlanId).toBe("p_1");
    expect(event.defaultPrevented).toBe(true);
  });

  // File links (Kafi, 2026-08-26): an absolute path opens in the room whose
  // folder holds it — the tab lands on the file and the route follows.
  it("a vynel://file click opens the file in its room's editor", async () => {
    const { wrapper, ui, router, list } = mountHost();
    await vi.waitFor(() => expect(list).toHaveBeenCalled());

    const href = fileLinkHref("C:\\Users\\me\\proj\\docs\\plan.md");
    await vi.waitFor(() => {
      const event = click(wrapper, href);
      expect(event.defaultPrevented).toBe(true);
      expect(ui.activeTab.workspaceId).toBe("ws-proj");
    });
    expect(ui.activeTab.shell.mainView).toEqual({ kind: "file", filePath: "docs/plan.md" });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("workspace"));
  });

  it("a relative path opens in the room on screen; outside every room nothing opens", async () => {
    const { wrapper, ui, list } = mountHost();
    await vi.waitFor(() => expect(list).toHaveBeenCalled());

    // Global surface: a relative path has no room to land in.
    click(wrapper, fileLinkHref("src/pricing.ts"));
    expect(ui.activeTab.workspaceId).toBeNull();

    ui.openWorkspaceTab("ws-site");
    click(wrapper, fileLinkHref("src/pricing.ts"));
    expect(ui.activeTab.workspaceId).toBe("ws-site");
    expect(ui.activeTab.shell.mainView).toEqual({ kind: "file", filePath: "src/pricing.ts" });

    // A file no room holds: the click is still ours (never a navigation),
    // but the tab stays where it was.
    const event = click(wrapper, fileLinkHref("D:\\elsewhere\\notes.md"));
    expect(event.defaultPrevented).toBe(true);
    expect(ui.activeTab.workspaceId).toBe("ws-site");
    expect(ui.activeTab.shell.mainView).toEqual({ kind: "file", filePath: "src/pricing.ts" });
  });

  it("leaves ordinary links alone", () => {
    const { wrapper, ui } = mountHost();

    const event = click(wrapper, "https://example.com");

    expect(ui.viewingPlanId).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const { wrapper, ui } = mountHost();
    const anchor = wrapper.get('a[href="vynel://plan/p_1"]').element;
    wrapper.unmount();

    document.body.appendChild(anchor);
    anchor.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(ui.viewingPlanId).toBeNull();
  });
});
