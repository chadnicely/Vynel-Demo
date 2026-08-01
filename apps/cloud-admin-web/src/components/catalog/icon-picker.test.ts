import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { CATALOG_ICON_NAMES } from "@vynel/contracts/marketplace/catalog-icons";
import IconPicker from "./IconPicker.vue";
import { CATALOG_ICON_COMPONENTS } from "./catalog-icon-components.js";

function mountPicker(modelValue = "", fallbackText = "Daily Briefing") {
  return mount(IconPicker, { props: { modelValue, fallbackText } });
}

describe("IconPicker", () => {
  it("offers exactly the curated contracts allowlist — never free text", () => {
    const wrapper = mountPicker();
    const titles = wrapper.findAll(".icon-cell").map((cell) => cell.attributes("title"));
    expect(titles).toEqual([...CATALOG_ICON_NAMES]);
    expect(wrapper.find("input").exists()).toBe(false);
  });

  it("every allowlisted name resolves to a real lucide component", () => {
    for (const name of CATALOG_ICON_NAMES) {
      expect(CATALOG_ICON_COMPONENTS[name], `icon '${name}'`).toBeTruthy();
    }
  });

  it("emits the picked name; picking again clears back to the monogram", async () => {
    const wrapper = mountPicker();
    await wrapper.find('.icon-cell[title="mail"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["mail"]);

    await wrapper.setProps({ modelValue: "mail" });
    await wrapper.find('.icon-cell[title="mail"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });

  it("previews the monogram while nothing (or an unknown legacy name) is selected", () => {
    // '' and a legacy out-of-list name both fall back — exactly what the
    // desktop card would render.
    expect(mountPicker("").find(".preview-monogram").text()).toBe("DB");
    expect(mountPicker("sunrise").find(".preview-monogram").text()).toBe("DB");
    expect(mountPicker("mail").find(".preview-monogram").exists()).toBe(false);
  });
});
