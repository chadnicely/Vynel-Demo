import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DemoSpokenCaption from "./DemoSpokenCaption.vue";

describe("DemoSpokenCaption", () => {
  const line = "Sales came in at $1,508 across the board today.";

  it("starts partway rather than dumping the whole sentence", () => {
    const wrapper = mount(DemoSpokenCaption, {
      props: { text: line, durationMs: 4000 },
    });
    expect(wrapper.text().length).toBeLessThan(line.length);
    expect(wrapper.text().length).toBeGreaterThan(0);
  });

  it("finishes the sentence within the line's own length", async () => {
    const wrapper = mount(DemoSpokenCaption, {
      props: { text: line, durationMs: 500 },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(wrapper.text()).toBe(line);
  });

  it("types by word, never mid-word", async () => {
    const wrapper = mount(DemoSpokenCaption, {
      props: { text: line, durationMs: 4000 },
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(line.startsWith(wrapper.text())).toBe(true);
    expect(`${line} `.startsWith(`${wrapper.text()} `)).toBe(true);
  });

  it("renders nothing for an empty line rather than a stray space", () => {
    const wrapper = mount(DemoSpokenCaption, { props: { text: "  ", durationMs: 0 } });
    expect(wrapper.text()).toBe("");
  });
});
