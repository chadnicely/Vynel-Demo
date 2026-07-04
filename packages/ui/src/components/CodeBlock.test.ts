import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CodeBlock from "./CodeBlock.vue";

// Highlighting loads async (shiki); the contract tested here is the immediate
// plain fallback — content renders synchronously, one .line per source line.
describe("CodeBlock", () => {
  it("renders every line of code immediately as plain text", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: "line one\nline two\nline three", language: "text" },
    });

    const lines = wrapper.findAll(".line");
    expect(lines).toHaveLength(3);
    expect(wrapper.text()).toContain("line two");
  });

  it("carries the start-line offset for the numbering counter", () => {
    const wrapper = mount(CodeBlock, {
      props: {
        code: "a\nb",
        language: "text",
        startLine: 40,
        lineNumbers: true,
      },
    });

    expect(wrapper.attributes("style")).toContain("--start-line: 40");
    expect(wrapper.classes()).toContain("has-line-numbers");
  });
});
