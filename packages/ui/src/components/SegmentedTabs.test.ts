import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SegmentedTabs from "./SegmentedTabs.vue";

const tabs = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "workspace", label: "Workspace" },
];

describe("SegmentedTabs", () => {
  it("renders one tab button per entry with the active one marked", () => {
    const wrapper = mount(SegmentedTabs, {
      props: { tabs, modelValue: "chat" },
    });

    const buttons = wrapper.findAll('[role="tab"]');
    expect(buttons.map((b) => b.text())).toEqual(["Home", "Chat", "Workspace"]);
    expect(buttons[1]!.attributes("aria-selected")).toBe("true");
    expect(buttons[0]!.attributes("aria-selected")).toBe("false");
  });

  it("emits update:modelValue with the clicked tab id", async () => {
    const wrapper = mount(SegmentedTabs, {
      props: { tabs, modelValue: "home" },
    });

    await wrapper.findAll('[role="tab"]')[2]!.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["workspace"]]);
  });
});
