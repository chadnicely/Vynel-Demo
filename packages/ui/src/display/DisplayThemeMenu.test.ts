import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayThemeMenu from "./DisplayThemeMenu.vue";
import { DISPLAY_SHAPES } from "./display-shapes.js";
import { DISPLAY_COLOURS } from "./display-colours.js";

function mountMenu(shape = "sphere", colour = "cyan") {
  return mount(DisplayThemeMenu, {
    props: { shape, colour },
    attachTo: document.body,
  });
}

function open(wrapper: ReturnType<typeof mountMenu>) {
  return wrapper.find('[data-testid="display-theme-trigger"]').trigger("click");
}

describe("DisplayThemeMenu", () => {
  it("names both axes on the trigger", () => {
    const wrapper = mountMenu("ribbon", "ember");
    const text = wrapper.find('[data-testid="display-theme-trigger"]').text();

    expect(text).toContain("Ribbon");
    expect(text).toContain("Ember");

    wrapper.unmount();
  });

  it("stays shut until asked", () => {
    const wrapper = mountMenu();

    expect(wrapper.find('[data-testid="display-theme-panel"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });

  it("lists every shape with its note, and every colour", async () => {
    const wrapper = mountMenu();
    await open(wrapper);

    for (const shape of DISPLAY_SHAPES) {
      const option = wrapper.find(
        `[data-testid="display-shape-option-${shape.id}"]`,
      );
      expect(option.exists()).toBe(true);
      expect(option.text()).toContain(shape.label);
      expect(option.text()).toContain(shape.note);
    }
    for (const colour of DISPLAY_COLOURS) {
      expect(
        wrapper
          .find(`[data-testid="display-colour-option-${colour.id}"]`)
          .exists(),
      ).toBe(true);
    }

    wrapper.unmount();
  });

  // The two axes must stay independent all the way through the component:
  // picking a shape must not emit a colour, and vice versa. If they leaked into
  // one event the split would be cosmetic.
  it("emits only the axis you touched", async () => {
    const wrapper = mountMenu();
    await open(wrapper);

    await wrapper
      .find('[data-testid="display-shape-option-flare"]')
      .trigger("click");
    expect(wrapper.emitted("update:shape")).toEqual([["flare"]]);
    expect(wrapper.emitted("update:colour")).toBeUndefined();

    await open(wrapper);
    await wrapper
      .find('[data-testid="display-colour-option-crimson"]')
      .trigger("click");
    expect(wrapper.emitted("update:colour")).toEqual([["crimson"]]);
    expect(wrapper.emitted("update:shape")).toHaveLength(1);

    wrapper.unmount();
  });

  // Picking a shape is a decision — get out of the way. Picking a colour is
  // something you do by eye across several tries, so the panel stays put.
  it("closes on a shape pick and stays open on a colour pick", async () => {
    const wrapper = mountMenu();
    await open(wrapper);

    await wrapper
      .find('[data-testid="display-colour-option-violet"]')
      .trigger("click");
    expect(wrapper.find('[data-testid="display-theme-panel"]').exists()).toBe(
      true,
    );

    await wrapper
      .find('[data-testid="display-shape-option-nova"]')
      .trigger("click");
    expect(wrapper.find('[data-testid="display-theme-panel"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });

  it("marks exactly one shape and one colour as checked", async () => {
    const wrapper = mountMenu("lattice", "mint");
    await open(wrapper);

    const checked = (selector: string) =>
      wrapper
        .findAll(selector)
        .filter((el) => el.attributes("aria-checked") === "true");

    expect(checked('[data-testid^="display-shape-option-"]')).toHaveLength(1);
    expect(checked('[data-testid^="display-colour-option-"]')).toHaveLength(1);
    expect(
      wrapper
        .find('[data-testid="display-shape-option-lattice"]')
        .attributes("aria-checked"),
    ).toBe("true");
    expect(
      wrapper
        .find('[data-testid="display-colour-option-mint"]')
        .attributes("aria-checked"),
    ).toBe("true");

    wrapper.unmount();
  });

  // Each swatch paints from its OWN colour block, which is what keeps the grid
  // a live preview rather than a second copy of the palette.
  it("tags each swatch with the colour it previews", async () => {
    const wrapper = mountMenu();
    await open(wrapper);

    for (const colour of DISPLAY_COLOURS) {
      const swatch = wrapper.find(
        `[data-testid="display-colour-option-${colour.id}"]`,
      );
      expect(swatch.attributes("data-display-colour")).toBe(colour.id);
      expect(swatch.classes()).toContain("display-palette");
    }

    wrapper.unmount();
  });

  it("closes on Escape", async () => {
    const wrapper = mountMenu();
    await open(wrapper);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="display-theme-panel"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });

  it("closes on a click outside, but not on one inside", async () => {
    const wrapper = mountMenu();
    await open(wrapper);

    wrapper.element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="display-theme-panel"]').exists()).toBe(
      true,
    );

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="display-theme-panel"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });

  // Ids no longer in either roster still have to render a legible trigger.
  it("falls back to the defaults for unknown ids", () => {
    const wrapper = mountMenu("retired-shape", "retired-colour");
    const text = wrapper.find('[data-testid="display-theme-trigger"]').text();

    expect(text).toContain("Core");
    expect(text).toContain("Cyan");

    wrapper.unmount();
  });
});
