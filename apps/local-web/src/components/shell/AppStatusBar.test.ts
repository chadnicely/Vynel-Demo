import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppStatusBar from "./AppStatusBar.vue";

describe("AppStatusBar", () => {
  it("renders the context label", () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        presenceState: "idle",
        contextLabel: "assistant idle · Home",
        pendingApprovals: 0,
      },
    });
    expect(wrapper.text()).toContain("assistant idle · Home");
  });

  it("shows and fires the approvals affordance when some are pending", async () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        presenceState: "attention",
        contextLabel: "x",
        pendingApprovals: 2,
      },
    });
    expect(wrapper.text()).toContain("2 approvals waiting");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("open-approvals")).toHaveLength(1);
  });

  it("singularizes and hides the affordance when none are pending", () => {
    const one = mount(AppStatusBar, {
      props: { presenceState: "attention", contextLabel: "x", pendingApprovals: 1 },
    });
    expect(one.text()).toContain("1 approval waiting");

    const none = mount(AppStatusBar, {
      props: { presenceState: "idle", contextLabel: "x", pendingApprovals: 0 },
    });
    expect(none.find("button").exists()).toBe(false);
    expect(none.text()).not.toContain("waiting");
  });
});
