import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayBackdrop from "./DisplayBackdrop.vue";

describe("DisplayBackdrop", () => {
  it("draws every layer the themes paint through", () => {
    const wrapper = mount(DisplayBackdrop);

    expect(wrapper.find(".bd-wash").exists()).toBe(true);
    expect(wrapper.findAll(".bd-aurora")).toHaveLength(6);
    expect(wrapper.findAll(".bd-stars")).toHaveLength(3);
    expect(wrapper.find(".bd-sheen").exists()).toBe(true);
    // The legibility floor — the room has to stay readable while it moves.
    expect(wrapper.find(".bd-scrim").exists()).toBe(true);
    // Black at the EDGES, clear through the middle: the falloff that makes the
    // subject read across a wall of monitors.
    expect(wrapper.find(".bd-vignette").exists()).toBe(true);
    // The black hole. Present in the markup, but its opacity is driven by a
    // variable that defaults to 0, so it stays off unless a shape with an
    // actual hole switches it on — on a solid shape it would sit straight on
    // top of the bright centre and put out the one thing meant to burn.
    //
    // Only its PRESENCE is asserted here: this environment does not apply
    // scoped stylesheets, so a computed-opacity check would read "" and pass
    // or fail for reasons that have nothing to do with the component.
    expect(wrapper.find(".bd-core-shade").exists()).toBe(true);
  });

  // It is decoration over a live voice session: it must never take a click
  // meant for the room, and it must never be announced.
  it("is inert and hidden from assistive tech", () => {
    const wrapper = mount(DisplayBackdrop);
    const root = wrapper.get('[data-testid="display-backdrop"]');

    expect(root.attributes("aria-hidden")).toBe("true");
    expect(root.element.querySelectorAll("button, a, input")).toHaveLength(0);
  });

  it("takes no props — a theme drives it entirely through CSS variables", () => {
    // Mounting with no props at all must be valid: `display-themes.css` is the
    // only thing that configures this component, so a theme can restyle the
    // ground without the view having to thread anything through.
    expect(() => mount(DisplayBackdrop)).not.toThrow();
  });
});
