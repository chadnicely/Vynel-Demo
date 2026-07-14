import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ResizablePanel from "./ResizablePanel.vue";

const KEY = "test.panel.width";

describe("ResizablePanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("falls back to the default width when nothing is stored", () => {
    const wrapper = mount(ResizablePanel, {
      props: { side: "left", storageKey: KEY, defaultWidth: 240 },
    });
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    expect((wrapper.element as HTMLElement).style.width).toBe("240px");
  });

  it("restores a clamped stored width on mount", () => {
    localStorage.setItem(KEY, "9999");
    const wrapper = mount(ResizablePanel, {
      props: { side: "left", storageKey: KEY, defaultWidth: 240, maxWidth: 420 },
    });
    expect((wrapper.element as HTMLElement).style.width).toBe("420px");
  });

  it("resizes by keyboard and persists (left grows with ArrowRight)", async () => {
    const wrapper = mount(ResizablePanel, {
      props: { side: "left", storageKey: KEY, defaultWidth: 240 },
    });
    await wrapper
      .get('[role="separator"]')
      .trigger("keydown", { key: "ArrowRight" });
    expect((wrapper.element as HTMLElement).style.width).toBe("248px");
    expect(localStorage.getItem(KEY)).toBe("248");
  });

  it("flips the keyboard direction for a right-side panel", async () => {
    const wrapper = mount(ResizablePanel, {
      props: { side: "right", storageKey: KEY, defaultWidth: 240 },
    });
    await wrapper
      .get('[role="separator"]')
      .trigger("keydown", { key: "ArrowRight" });
    // A right panel shrinks when the divider moves right.
    expect((wrapper.element as HTMLElement).style.width).toBe("232px");
  });

  it("resets to the default width via the exposed method", async () => {
    localStorage.setItem(KEY, "300");
    const wrapper = mount(ResizablePanel, {
      props: { side: "left", storageKey: KEY, defaultWidth: 240 },
    });
    expect((wrapper.element as HTMLElement).style.width).toBe("300px");
    (wrapper.vm as unknown as { reset: () => void }).reset();
    await wrapper.vm.$nextTick();
    expect((wrapper.element as HTMLElement).style.width).toBe("240px");
  });
});
