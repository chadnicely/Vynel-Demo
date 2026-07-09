import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SessionsPanel from "./SessionsPanel.vue";

const baseProps = {
  sessions: [],
  activeSessionId: null,
};

describe("SessionsPanel", () => {
  it("offers a new conversation when the surface allows it, and emits on click", async () => {
    const wrapper = mount(SessionsPanel, {
      props: { ...baseProps, canStartNew: true },
    });

    const button = wrapper.find(".new-conversation");
    expect(button.text()).toContain("New");

    await button.trigger("click");
    expect(wrapper.emitted("startNew")).toHaveLength(1);
  });

  it("hides the affordance by default (the global brain stays one thread)", () => {
    const wrapper = mount(SessionsPanel, { props: baseProps });

    expect(wrapper.find(".new-conversation").exists()).toBe(false);
  });
});
