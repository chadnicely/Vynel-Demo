import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import {
  GLOBAL_SCOPE_KEY,
  useCustomizeStore,
} from "../../stores/customize-store.js";
import GlobalCustomizeSection from "./GlobalCustomizeSection.vue";

function mountSection() {
  const pinia = createPinia();
  const wrapper = mount(GlobalCustomizeSection, {
    global: { plugins: [pinia] },
  });
  return { wrapper, pinia };
}

describe("GlobalCustomizeSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("offers the icon and the menu editor — no name fields, no Apps row", async () => {
    const { wrapper } = mountSection();
    await flushPromises();

    // No workspace/persona name inputs — the global assistant IS Claude.
    expect(wrapper.find("input[type='text'][placeholder='Sarah']").exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("Conversation icon");
    // The catalog minus Apps.
    expect(wrapper.findAll(".entry-row").length).toBe(15);
    expect(wrapper.text()).not.toContain("Apps");
  });

  it("menu edits land under the global scope key", async () => {
    const { wrapper, pinia } = mountSection();
    await flushPromises();

    await wrapper.get('[aria-label="Hide Journal"]').trigger("click");

    const store = useCustomizeStore(pinia);
    expect(
      store
        .customizationFor(GLOBAL_SCOPE_KEY)
        .entries.find((entry) => entry.sectionId === "journal")?.isHidden,
    ).toBe(true);
    expect(store.isCustomized(GLOBAL_SCOPE_KEY)).toBe(true);
  });

  it("clearing the persona image returns to the Claude mark", async () => {
    const { wrapper, pinia } = mountSection();
    await flushPromises();
    const store = useCustomizeStore(pinia);

    store.setPersonaImage(GLOBAL_SCOPE_KEY, "data:image/png;base64,AAAA");
    await flushPromises();
    expect(wrapper.find(".persona-icon-picker img").exists()).toBe(true);

    await wrapper
      .get(".persona-icon-picker button:last-of-type")
      .trigger("click");
    expect(store.customizationFor(GLOBAL_SCOPE_KEY).personaImage).toBeNull();
  });
});
