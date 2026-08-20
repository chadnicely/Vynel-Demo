import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayPanel from "./DisplayPanel.vue";

describe("DisplayPanel", () => {
  it("renders the title, every row, and the corner chrome", () => {
    const wrapper = mount(DisplayPanel, {
      props: {
        title: "System",
        rows: [
          { label: "Engine", value: "Ready" },
          { label: "Workspaces", value: "4" },
        ],
      },
    });

    expect(wrapper.find(".panel-title").text()).toBe("System");
    expect(wrapper.findAll(".panel-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Engine");
    expect(wrapper.text()).toContain("Ready");
    expect(wrapper.findAll(".tick")).toHaveLength(4);
  });

  it("marks each row with its tone, defaulting when none is given", () => {
    const wrapper = mount(DisplayPanel, {
      props: {
        title: "Status",
        rows: [
          { label: "Idle", value: "-" },
          { label: "Working", value: "2", tone: "live" },
          { label: "Needs you", value: "1", tone: "attention" },
          { label: "Archived", value: "9", tone: "muted" },
        ],
      },
    });

    const values = wrapper.findAll(".row-value");
    expect(values[0]!.classes()).toContain("is-default");
    expect(values[1]!.classes()).toContain("is-live");
    expect(values[2]!.classes()).toContain("is-attention");
    expect(values[3]!.classes()).toContain("is-muted");
  });

  it("renders a custom body through the default slot", () => {
    const wrapper = mount(DisplayPanel, {
      props: { title: "Telemetry", rows: [] },
      slots: { default: "<p class='log'>turn started</p>" },
    });

    expect(wrapper.findAll(".panel-row")).toHaveLength(0);
    expect(wrapper.find(".log").text()).toBe("turn started");
  });
});
