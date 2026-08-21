import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ViewModeSwitch from "./ViewModeSwitch.vue";

function mountSwitch(overrides: Record<string, unknown> = {}) {
  return mount(ViewModeSwitch, {
    props: { mode: "normal", displayLive: false, fullView: false, ...overrides },
  });
}

function segments(wrapper: ReturnType<typeof mountSwitch>) {
  return wrapper.findAll("button").map((button) => ({
    label: button.attributes("aria-label"),
    pressed: button.attributes("aria-pressed"),
  }));
}

// The title bar's view switch (Kafi, 2026-08-22): three segments on one
// plate, the live one pressed, and the full-view expander only where a full
// view exists to go to.
describe("ViewModeSwitch", () => {
  it("renders Nodes | Display | Normal with the live mode pressed, and no expander on the normal view", () => {
    expect(segments(mountSwitch())).toEqual([
      { label: "Nodes", pressed: "false" },
      { label: "Display", pressed: "false" },
      { label: "Normal view", pressed: "true" },
    ]);
  });

  it("offers the expander on a full-capable view, reading the full-view state", () => {
    expect(segments(mountSwitch({ mode: "nodes" })).at(-1)).toEqual({
      label: "Full view",
      pressed: "false",
    });
    expect(segments(mountSwitch({ mode: "display", fullView: true })).at(-1)).toEqual({
      label: "Exit full view",
      pressed: "true",
    });
  });

  it("emits the picked mode and the expander's toggle", async () => {
    const wrapper = mountSwitch({ mode: "nodes" });
    await wrapper.get('[aria-label="Display"]').trigger("click");
    await wrapper.get('[aria-label="Normal view"]').trigger("click");
    await wrapper.get('[aria-label="Full view"]').trigger("click");

    expect(wrapper.emitted("pick")).toEqual([["display"], ["normal"]]);
    expect(wrapper.emitted("toggle-full-view")).toEqual([[]]);
  });

  // A conversation running behind another view must stay visible — the
  // segment glows the way the old Broadcast glyph did, without being pressed.
  it("lights the Display segment while the voice runs behind another view", () => {
    const display = mountSwitch({ mode: "normal", displayLive: true }).get(
      '[aria-label="Display"]',
    );
    expect(display.classes()).toContain("live");
    expect(display.attributes("aria-pressed")).toBe("false");
  });

  // The plate only borrows the Display's palette while it floats over the
  // Display with the chrome gone; everywhere else it is the bar's quiet chrome.
  it("wears the Display skin only in the Display's full view", () => {
    expect(mountSwitch({ mode: "display", fullView: true }).attributes("data-skin")).toBe(
      "display",
    );
    expect(mountSwitch({ mode: "display" }).attributes("data-skin")).toBe("chrome");
    expect(mountSwitch({ mode: "nodes", fullView: true }).attributes("data-skin")).toBe(
      "chrome",
    );
  });
});
