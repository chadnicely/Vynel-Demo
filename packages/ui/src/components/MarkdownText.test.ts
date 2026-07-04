import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MarkdownText from "./MarkdownText.vue";

// MarkdownText is the one v-html surface — these tests are what keep the
// eslint-disable defensible: hostile markdown must come out inert.
describe("MarkdownText", () => {
  it("renders markdown structure", () => {
    const wrapper = mount(MarkdownText, {
      props: {
        source: "**Done.** The new price is `$49`.\n\n- item one\n- item two",
      },
    });

    expect(wrapper.find("strong").text()).toBe("Done.");
    expect(wrapper.find("code").text()).toBe("$49");
    expect(wrapper.findAll("li")).toHaveLength(2);
  });

  it("renders hostile HTML as inert text — no script or img elements", () => {
    const wrapper = mount(MarkdownText, {
      props: {
        source:
          "hello <script>alert(1)</" +
          'script> <img src=x onerror="alert(1)"> world',
      },
    });

    // markdown-it (html:false) escapes raw HTML to text; DOMPurify backstops.
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("hello");
    expect(wrapper.text()).toContain("world");
  });

  it("neutralizes javascript: links", () => {
    const wrapper = mount(MarkdownText, {
      props: { source: "[click me](javascript:alert(1))" },
    });

    const href = wrapper.find("a").exists()
      ? wrapper.find("a").attributes("href")
      : undefined;
    expect(href ?? "").not.toContain("javascript:");
  });
});
