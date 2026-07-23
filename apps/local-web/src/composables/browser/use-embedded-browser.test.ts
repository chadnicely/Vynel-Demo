import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useEmbeddedBrowser } from "./use-embedded-browser.js";
import type { EmbeddedBrowser } from "./use-embedded-browser.js";

interface RecordedCall {
  command: string;
  args?: Record<string, unknown>;
}

const PAGE_RECT = { x: 800, y: 80, width: 600, height: 500 };

// happy-dom may not ship ResizeObserver — the composable needs the class to
// exist; observations themselves aren't under test here.
class QuietResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function stubTauri(calls: RecordedCall[]) {
  (window as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (command: string, args?: Record<string, unknown>) => {
        calls.push(args === undefined ? { command } : { command, args });
        return Promise.resolve();
      },
    },
  };
}

function mountHarness() {
  let api!: EmbeddedBrowser;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useEmbeddedBrowser();
        return () =>
          h("div", {
            ref: (el) => {
              api.viewport.value = el as HTMLElement | null;
            },
          });
      },
    }),
  );
  // happy-dom lays nothing out — hand the viewport a real rectangle.
  if (api.viewport.value !== null) {
    api.viewport.value.getBoundingClientRect = () =>
      ({ ...PAGE_RECT, top: 80, left: 800, right: 1400, bottom: 580 }) as DOMRect;
  }
  return { api, wrapper };
}

describe("useEmbeddedBrowser", () => {
  beforeEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
      QuietResizeObserver;
  });

  afterEach(() => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it("outside the desktop shell everything is an inert no-op", () => {
    const { api } = mountHarness();

    expect(api.isNative).toBe(false);
    api.show("https://example.com");
    api.hide();
    api.close();
  });

  it("show opens the page at the viewport's bounds, visibly — in ONE call", () => {
    const calls: RecordedCall[] = [];
    stubTauri(calls);
    const { api } = mountHarness();

    expect(api.isNative).toBe(true);
    api.show("https://example.com");

    expect(calls).toEqual([
      {
        command: "browser_open",
        args: { url: "https://example.com", ...PAGE_RECT, visible: true },
      },
    ]);
  });

  it("showing while obscured opens the page HIDDEN — no flash over overlays", () => {
    const calls: RecordedCall[] = [];
    stubTauri(calls);
    const { api } = mountHarness();

    api.setObscured(true);
    calls.length = 0;
    api.show("https://example.com");

    expect(calls[0]).toEqual({
      command: "browser_open",
      args: { url: "https://example.com", ...PAGE_RECT, visible: false },
    });
  });

  it("resyncs bounds on window resize (position-only panel shifts)", () => {
    const calls: RecordedCall[] = [];
    stubTauri(calls);
    const { api } = mountHarness();
    api.show("https://example.com");
    calls.length = 0;

    window.dispatchEvent(new Event("resize"));

    expect(calls[0]).toEqual({ command: "browser_set_bounds", args: PAGE_RECT });
  });

  it("hide and obscure both yield the page; unobscuring restores it", () => {
    const calls: RecordedCall[] = [];
    stubTauri(calls);
    const { api } = mountHarness();
    api.show("https://example.com");
    calls.length = 0;

    api.setObscured(true);
    expect(calls.at(-1)).toEqual({
      command: "browser_set_visible",
      args: { visible: false },
    });

    api.setObscured(false);
    expect(calls.at(-1)).toEqual({
      command: "browser_set_visible",
      args: { visible: true },
    });

    api.hide();
    expect(calls.at(-1)).toEqual({
      command: "browser_set_visible",
      args: { visible: false },
    });
  });

  it("closes the native webview on close() and again on unmount", () => {
    const calls: RecordedCall[] = [];
    stubTauri(calls);
    const { api, wrapper } = mountHarness();
    api.show("https://example.com");
    calls.length = 0;

    api.close();
    expect(calls.at(-1)).toEqual({ command: "browser_close" });

    wrapper.unmount();
    expect(calls.filter((call) => call.command === "browser_close")).toHaveLength(2);
  });
});
