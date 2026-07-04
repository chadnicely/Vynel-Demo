import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VoiceOrb from "./VoiceOrb.vue";

describe("VoiceOrb", () => {
  it("defaults to idle with an accessible status label", () => {
    const wrapper = mount(VoiceOrb);

    expect(wrapper.classes()).toContain("is-idle");
    expect(wrapper.attributes("aria-label")).toBe("voice idle");
  });

  it("reflects each state as a class and sizes from the prop", () => {
    const wrapper = mount(VoiceOrb, {
      props: { state: "speaking", size: 220 },
    });

    expect(wrapper.classes()).toContain("is-speaking");
    expect(wrapper.attributes("style")).toContain("width: 220px");
  });
});
