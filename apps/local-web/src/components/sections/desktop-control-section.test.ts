// Settings → Desktop control: the one toggle, the state it reports, and the
// four honest claims the screen makes. The copy IS the feature here — a user
// decides whether to hand over their desktop on the strength of it — so each
// claim is asserted literally rather than paraphrased.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import DesktopControlSection from "./DesktopControlSection.vue";

const DEFAULT_PREFERENCES = {
  theme: "system",
  defaultWorkspaceId: null,
  chatStreamingEnabled: true,
  reducedMotion: false,
  voiceTtsModelId: "kokoro",
  voiceSpeakerId: 0,
  voiceSttModelId: "moonshine-base",
  desktopActionsEnabled: false,
};

function harness(preferences = DEFAULT_PREFERENCES) {
  const updatePreferences = vi.fn(async (patch: Record<string, unknown>) => ({
    ...preferences,
    ...patch,
  }));
  const client = {
    users: { getPreferences: async () => preferences, updatePreferences },
  } as unknown as VynelClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(DesktopControlSection, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient }] as [typeof VueQueryPlugin, unknown]],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, updatePreferences };
}

describe("DesktopControlSection", () => {
  it("shows the toggle OFF and says Vynel cannot act, when acting is off", async () => {
    const { wrapper } = harness();
    await flushPromises();

    const toggle = wrapper.find(".acting-toggle input");
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find(".acting-toggle").text()).toContain(
      "Let Vynel act on your desktop (click, type, press keys)",
    );
    const state = wrapper.find(".acting-state").text();
    expect(state).toContain("can look at your desktop");
    expect(state).toContain("not act on it");
  });

  it("shows the toggle ON and says Vynel can act, when acting is on", async () => {
    const { wrapper } = harness({ ...DEFAULT_PREFERENCES, desktopActionsEnabled: true });
    await flushPromises();

    expect((wrapper.find(".acting-toggle input").element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find(".acting-state").text()).toContain("and act on it");
  });

  it("saves the preference when turned on", async () => {
    const { wrapper, updatePreferences } = harness();
    await flushPromises();

    await wrapper.find(".acting-toggle input").setValue(true);
    await flushPromises();
    expect(updatePreferences).toHaveBeenCalledWith({ desktopActionsEnabled: true });
  });

  it("saves the preference when turned back off", async () => {
    const { wrapper, updatePreferences } = harness({
      ...DEFAULT_PREFERENCES,
      desktopActionsEnabled: true,
    });
    await flushPromises();

    await wrapper.find(".acting-toggle input").setValue(false);
    await flushPromises();
    expect(updatePreferences).toHaveBeenCalledWith({ desktopActionsEnabled: false });
  });

  it("says a change takes effect from the next turn", async () => {
    const { wrapper } = harness();
    await flushPromises();
    expect(wrapper.find(".next-turn-note").text()).toContain("takes effect from the next turn");
  });

  it("makes all four honest claims about what this does", async () => {
    const { wrapper } = harness();
    await flushPromises();
    const copy = wrapper.find(".honest-copy").text();

    expect(copy).toContain("Looking is always allowed");
    expect(copy).toContain("Acting is off until you turn it on");
    expect(copy).toContain("recorded in Vynel's desktop actions log");
    expect(copy).toContain("acts without asking you each time");
  });

  it("reports a load failure instead of rendering a toggle that saves nothing", async () => {
    const client = {
      users: {
        getPreferences: async () => {
          throw new Error("offline");
        },
      },
    } as unknown as VynelClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(DesktopControlSection, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient }] as [typeof VueQueryPlugin, unknown]],
        provide: { [vynelClientKey as symbol]: client },
      },
    });
    await flushPromises();

    expect(wrapper.find("[role='alert']").exists()).toBe(true);
    expect(wrapper.find(".acting-toggle").exists()).toBe(false);
  });
});
