// The banner is the NON-DELEGATION origin note only (B5 dissolved the
// per-delegation chips into the thread's live persona cards — those carry the
// Watch/Stop affordances now).

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ProcessingBanner from "./ProcessingBanner.vue";

describe("ProcessingBanner", () => {
  it("renders nothing while idle", () => {
    const wrapper = mount(ProcessingBanner, {
      props: { backgroundTurnLabel: null },
    });
    expect(wrapper.find(".processing-banner").exists()).toBe(false);
  });

  it("shows the background-turn origin note", () => {
    const wrapper = mount(ProcessingBanner, {
      props: { backgroundTurnLabel: "Replying on Telegram…" },
    });
    expect(wrapper.text()).toContain("Replying on Telegram…");
  });
});
