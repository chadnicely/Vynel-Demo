import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import BrowserPanel from "./BrowserPanel.vue";
import { useBrowserStore } from "../../stores/browser-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";

// The Global tab has no workspace, so the apps query stays idle — the fake
// client is only here to satisfy the provide.
const fakeClient = {
  workspaceApps: { list: async () => [] },
} as unknown as VynelClient;

function mountPanel() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(BrowserPanel, {
    global: {
      plugins: [
        pinia,
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: fakeClient },
    },
  });
  return { wrapper };
}

describe("BrowserPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("invites opening a page when no tab is open", () => {
    const { wrapper } = mountPanel();

    expect(wrapper.text()).toContain("Open an app or a page");
    expect(wrapper.find('[aria-label="Open a page"]').exists()).toBe(true);
    expect(wrapper.find("iframe").exists()).toBe(false);
  });

  it("renders the active tab in a sandboxed iframe with the address bar synced", async () => {
    const { wrapper } = mountPanel();
    const browser = useBrowserStore();

    browser.openTab({ url: "http://localhost:4321", title: "Letterman" });
    await wrapper.vm.$nextTick();

    const frame = wrapper.find("iframe");
    expect(frame.attributes("src")).toBe("http://localhost:4321");
    expect(frame.attributes("sandbox")).toContain("allow-scripts");
    expect(
      (wrapper.find('[aria-label="Page address"]').element as HTMLInputElement)
        .value,
    ).toBe("http://localhost:4321");
  });

  it("a submitted address normalizes to a scheme and renames a custom tab", async () => {
    const { wrapper } = mountPanel();
    const browser = useBrowserStore();
    browser.openTab({ url: "", title: "New tab" });
    await wrapper.vm.$nextTick();

    await wrapper.find('[aria-label="Page address"]').setValue("example.com");
    await wrapper.find("form").trigger("submit");

    expect(browser.activeTab?.url).toBe("https://example.com");
    expect(browser.activeTab?.title).toBe("example.com");
  });

  it("localhost addresses normalize to http, not https", async () => {
    const { wrapper } = mountPanel();
    const browser = useBrowserStore();
    browser.openTab({ url: "", title: "New tab" });
    await wrapper.vm.$nextTick();

    await wrapper.find('[aria-label="Page address"]').setValue("localhost:5173");
    await wrapper.find("form").trigger("submit");

    expect(browser.activeTab?.url).toBe("http://localhost:5173");
  });

  it("the Ask-Claude note lands in the composer seed as a reviewable draft", async () => {
    const { wrapper } = mountPanel();
    const browser = useBrowserStore();
    const ui = useUiStore();
    browser.openTab({ url: "http://localhost:4321", title: "Letterman" });
    await wrapper.vm.$nextTick();

    await wrapper.find('[aria-label="Ask Claude about this page"]').trigger("click");
    await wrapper
      .find('[aria-label="Note for Claude"]')
      .setValue("Make the header sticky");
    await wrapper.find('[aria-label="Add note to chat"]').trigger("click");

    expect(ui.composerSeed).toBe(
      'About "Letterman" (http://localhost:4321):\nMake the header sticky',
    );
    // The drawer closes; nothing was sent anywhere.
    expect(wrapper.find('[aria-label="Note for Claude"]').exists()).toBe(false);
  });

  it("closing the view is one click from the panel", async () => {
    const { wrapper } = mountPanel();
    const browser = useBrowserStore();
    browser.openView();

    await wrapper.find('[aria-label="Close browser view"]').trigger("click");

    expect(browser.isOpen).toBe(false);
  });
});
