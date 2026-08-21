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
// plate, the live one pressed — and nothing else: Nodes and the Display open
// full by themselves, so there is no expander to offer.
describe("ViewModeSwitch", () => {
  it("renders exactly Nodes | Display | Normal with the live mode pressed", () => {
    expect(segments(mountSwitch())).toEqual([
      { label: "Nodes", pressed: "false" },
      { label: "Display", pressed: "false" },
      { label: "Normal view", pressed: "true" },
    ]);
    expect(segments(mountSwitch({ mode: "nodes", fullView: true }))).toHaveLength(3);
  });

  it("emits the picked mode", async () => {
    const wrapper = mountSwitch({ mode: "nodes" });
    await wrapper.get('[aria-label="Display"]').trigger("click");
    await wrapper.get('[aria-label="Normal view"]').trigger("click");
    expect(wrapper.emitted("pick")).toEqual([["display"], ["normal"]]);
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
  // Display; over the Nodes screen and on the normal view it is quiet chrome.
  it("wears the Display skin only over the Display", () => {
    expect(mountSwitch({ mode: "display", fullView: true }).attributes("data-skin")).toBe(
      "display",
    );
    expect(mountSwitch({ mode: "nodes", fullView: true }).attributes("data-skin")).toBe(
      "chrome",
    );
    expect(mountSwitch({ mode: "normal" }).attributes("data-skin")).toBe("chrome");
  });
});
