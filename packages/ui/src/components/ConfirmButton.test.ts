import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmButton from "./ConfirmButton.vue";

describe("ConfirmButton", () => {
  it("arms on first click and confirms on the second", async () => {
    const wrapper = mount(ConfirmButton, {
      props: { label: "Remove", confirmLabel: "Sure?" },
    });

    expect(wrapper.text()).toContain("Remove");
    expect(wrapper.emitted("confirm")).toBeUndefined();

    await wrapper.find("button").trigger("click");
    expect(wrapper.text()).toContain("Sure?");
    expect(wrapper.get("button").attributes("aria-pressed")).toBe("true");
    expect(wrapper.emitted("confirm")).toBeUndefined();

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
    expect(wrapper.text()).toContain("Remove");
  });

  it("disarms on blur", async () => {
    const wrapper = mount(ConfirmButton, {
      props: { label: "Delete", confirmLabel: "Confirm" },
    });

    await wrapper.find("button").trigger("click");
    expect(wrapper.text()).toContain("Confirm");

    await wrapper.find("button").trigger("blur");
    expect(wrapper.text()).toContain("Delete");
  });

  it("does nothing while busy or disabled", async () => {
    const wrapper = mount(ConfirmButton, {
      props: { label: "Remove", busy: true },
    });

    await wrapper.find("button").trigger("click");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });
});
