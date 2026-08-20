import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayStrip from "./DisplayStrip.vue";

const baseProps = {
  brand: "Vynel",
  subtitle: "Global",
  linked: true,
  building: 2,
  needYou: 0,
  clock: "14:07",
};

describe("DisplayStrip", () => {
  it("renders the brand, the counters and the clock", () => {
    const wrapper = mount(DisplayStrip, { props: baseProps });

    expect(wrapper.find(".brand").text()).toBe("Vynel");
    expect(wrapper.find(".subtitle").text()).toBe("Global");
    expect(wrapper.find(".clock").text()).toBe("14:07");
    expect(wrapper.text()).toContain("Building 2");
    expect(wrapper.text()).toContain("Needs you 0");
  });

  it("lights the link pill only while linked", async () => {
    const wrapper = mount(DisplayStrip, { props: baseProps });
    const link = () => wrapper.findAll(".pill")[0]!;

    expect(link().text()).toBe("Linked");
    expect(link().classes()).toContain("on");

    await wrapper.setProps({ linked: false });

    expect(link().text()).toBe("Offline");
    expect(link().classes()).not.toContain("on");
  });

  it("flags the needs-you pill once something is waiting", async () => {
    const wrapper = mount(DisplayStrip, { props: baseProps });
    const needYou = () => wrapper.findAll(".pill")[2]!;

    expect(needYou().classes()).not.toContain("attention");

    await wrapper.setProps({ needYou: 3 });

    expect(needYou().text()).toBe("Needs you 3");
    expect(needYou().classes()).toContain("attention");
  });

  it("lays the host's voice controls out on the right", () => {
    const wrapper = mount(DisplayStrip, {
      props: baseProps,
      slots: { default: "<button class='voice'>Listening</button>" },
    });

    expect(wrapper.find(".actions .voice").text()).toBe("Listening");
  });
});
