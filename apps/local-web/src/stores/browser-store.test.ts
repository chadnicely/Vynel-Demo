import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBrowserStore } from "./browser-store.js";

describe("browser-store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts closed and empty", () => {
    const browser = useBrowserStore();

    expect(browser.isOpen).toBe(false);
    expect(browser.tabs).toHaveLength(0);
    expect(browser.activeTab).toBeNull();
  });

  it("opens a tab and activates it", () => {
    const browser = useBrowserStore();

    const tab = browser.openTab({ url: "http://localhost:4321", title: "Letterman" });

    expect(browser.activeTab?.id).toBe(tab.id);
    expect(browser.activeTab?.url).toBe("http://localhost:4321");
  });

  it("an app opens ONE tab — reopening focuses and refreshes its url", () => {
    const browser = useBrowserStore();
    const first = browser.openTab({
      url: "http://localhost:4321",
      title: "Letterman",
      appId: "app-1",
    });
    browser.openTab({ url: "https://example.com", title: "example.com" });

    const again = browser.openTab({
      url: "http://localhost:4322",
      title: "Letterman",
      appId: "app-1",
    });

    expect(again.id).toBe(first.id);
    expect(browser.tabs).toHaveLength(2);
    expect(browser.activeTabId).toBe(first.id);
    expect(browser.activeTab?.url).toBe("http://localhost:4322");
  });

  it("custom URLs always open their own tab", () => {
    const browser = useBrowserStore();
    browser.openTab({ url: "https://example.com", title: "example.com" });
    browser.openTab({ url: "https://example.com", title: "example.com" });

    expect(browser.tabs).toHaveLength(2);
  });

  it("closing the active tab hands focus to a neighbor, closing the last clears", () => {
    const browser = useBrowserStore();
    const first = browser.openTab({ url: "https://a.dev", title: "a" });
    const second = browser.openTab({ url: "https://b.dev", title: "b" });

    browser.activateTab(first.id);
    browser.closeTab(first.id);
    expect(browser.activeTabId).toBe(second.id);

    browser.closeTab(second.id);
    expect(browser.activeTab).toBeNull();
    expect(browser.tabs).toHaveLength(0);
  });

  it("setTabUrl retargets a tab, optionally renaming it", () => {
    const browser = useBrowserStore();
    const tab = browser.openTab({ url: "", title: "New tab" });

    browser.setTabUrl(tab.id, "https://vynel.dev", "vynel.dev");

    expect(browser.activeTab?.url).toBe("https://vynel.dev");
    expect(browser.activeTab?.title).toBe("vynel.dev");
  });

  it("only http(s) pages may load — script/data/file urls empty the tab", () => {
    const browser = useBrowserStore();
    const tab = browser.openTab({
      url: "javascript:alert(1)",
      title: "evil",
    });
    expect(tab.url).toBe("");

    browser.setTabUrl(tab.id, "data:text/html,<script>alert(1)</script>");
    expect(browser.activeTab?.url).toBe("");

    browser.setTabUrl(tab.id, "file:///etc/passwd");
    expect(browser.activeTab?.url).toBe("");
  });

  it("refuses to frame the shell's own origin (the one real sandbox escape)", () => {
    const browser = useBrowserStore();

    const tab = browser.openTab({
      url: `${window.location.origin}/chat`,
      title: "self",
    });

    expect(tab.url).toBe("");
  });
});
