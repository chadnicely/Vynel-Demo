// Settings → Desktop control: the one toggle, the state it reports, the whole
// grant it names, and the honest claims the screen makes. The copy IS the
// feature here — a user decides whether to hand over their desktop on the
// strength of it — so each claim is asserted literally rather than paraphrased.
//
// The grant list is asserted item by item because this switch composes ELEVEN
// tools, not the three the headline used to name: acting, launching, opening
// links, the window tools, volume, and BOTH clipboard tools. The clipboard READ
// is the one a user would never guess, so it gets its own assertion.

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

/** `textContent` keeps the template's line breaks + indentation; the copy under
 *  test wraps across source lines, so it is compared as rendered prose. */
function squish(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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
  it("shows the toggle OFF and says Vynel cannot do things, when acting is off", async () => {
    const { wrapper } = harness();
    await flushPromises();

    const toggle = wrapper.find(".acting-toggle input");
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    expect(squish(wrapper.find(".acting-toggle").text())).toContain(
      "Let Vynel do things on your desktop, not just look at it",
    );
    const state = squish(wrapper.find(".acting-state").text());
    expect(state).toContain("can look at your desktop");
    expect(state).toContain("cannot do things on it");
  });

  it("shows the toggle ON and says Vynel can do things, when acting is on", async () => {
    const { wrapper } = harness({ ...DEFAULT_PREFERENCES, desktopActionsEnabled: true });
    await flushPromises();

    expect((wrapper.find(".acting-toggle input").element as HTMLInputElement).checked).toBe(true);
    expect(squish(wrapper.find(".acting-state").text())).toContain("and do things on it");
  });

  it("names the WHOLE grant — acting, opening, windows and volume, and the clipboard", async () => {
    const { wrapper } = harness();
    await flushPromises();
    const grants = squish(wrapper.find(".acting-grants").text());

    expect(grants).toContain("Act inside your apps — click, type, press keys.");
    expect(grants).toContain("Open apps and open links.");
    expect(grants).toContain(
      "Arrange your windows — move, resize, bring to the front — and change the volume.",
    );
    expect(grants).toContain("Read and write your clipboard.");
  });

  it("warns that READING the clipboard rides this switch too", async () => {
    const { wrapper } = harness();
    await flushPromises();

    expect(squish(wrapper.find(".acting-grants").text())).toContain(
      "Reading your clipboard rides this switch too, so whatever you copied last — a password, say — is something Vynel can read.",
    );
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

  // The dangerous direction: the user takes acting AWAY, the save fails, and the
  // engine still has it. A box left unchecked would be a lie about a grant.
  it("rolls the box back to the stored state when the save fails, and says so", async () => {
    const preferences = { ...DEFAULT_PREFERENCES, desktopActionsEnabled: true };
    const client = {
      users: {
        getPreferences: async () => preferences,
        updatePreferences: async () => {
          throw new Error("offline");
        },
      },
    } as unknown as VynelClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = mount(DesktopControlSection, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient }] as [typeof VueQueryPlugin, unknown]],
        provide: { [vynelClientKey as symbol]: client },
      },
    });
    await flushPromises();

    const toggle = wrapper.find(".acting-toggle input");
    await toggle.setValue(false);
    await flushPromises();
    await flushPromises();

    expect((toggle.element as HTMLInputElement).checked).toBe(true);
    expect(squish(wrapper.find(".acting-state").text())).toContain("and do things on it");
    expect(wrapper.find("[role='alert']").text()).toContain("Your setting is unchanged.");
  });

  it("says a change takes effect from the next turn", async () => {
    const { wrapper } = harness();
    await flushPromises();
    expect(squish(wrapper.find(".next-turn-note").text())).toContain(
      "takes effect from the next turn",
    );
  });

  it("makes all four honest claims about what this does", async () => {
    const { wrapper } = harness();
    await flushPromises();
    const copy = squish(wrapper.find(".honest-copy").text());

    expect(copy).toContain("Screenshots and window lists are always allowed");
    expect(copy).toContain("Everything in the list above is off until you turn it on");
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
