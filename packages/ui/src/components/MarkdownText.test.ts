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

  it("keeps in-app vynel:// links through sanitizing (the shell's link router owns the click)", () => {
    const wrapper = mount(MarkdownText, {
      props: { source: "Review [Launch day](vynel://plan/p_1) before Friday." },
    });

    const link = wrapper.get("a");
    expect(link.attributes("href")).toBe("vynel://plan/p_1");
    expect(link.text()).toBe("Launch day");
  });

  it("renders task-list markers as checkboxes", () => {
    const wrapper = mount(MarkdownText, {
      props: { source: "- [x] Export ledger\n- [ ] Call the accountant" },
    });

    const boxes = wrapper.findAll(".task-checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.classes()).toContain("is-done");
    expect(boxes[1]!.classes()).not.toContain("is-done");
    expect(wrapper.text()).not.toContain("[x]");
  });

  it("renders fenced code blocks as code even before the highlighter loads", () => {
    const wrapper = mount(MarkdownText, {
      props: { source: "```js\nconst price = 49;\n```" },
    });

    // happy-dom's parser drops the <pre> wrapper inside sanitized v-html
    // (browsers keep it — covered by the live sweep); assert the code element.
    expect(wrapper.find("code.language-js").exists()).toBe(true);
    expect(wrapper.text()).toContain("const price = 49;");
  });
});

// File paths become in-app links (Kafi, 2026-08-26): in prose and in inline
// code, never inside a real URL or a code block.
describe("MarkdownText file links", () => {
  it("links paths in prose and in inline code on the app's file scheme", () => {
    const wrapper = mount(MarkdownText, {
      props: { source: "Wrote `docs/plan.md` and C:\\Users\\me\\a.ts today." },
    });
    const links = wrapper.findAll("a.file-link");
    expect(links.map((link) => link.text())).toEqual(["docs/plan.md", "C:\\Users\\me\\a.ts"]);
    expect(links[0]!.attributes("href")).toBe(`vynel://file/${encodeURIComponent("docs/plan.md")}`);
    expect(wrapper.find("code a.file-link").exists()).toBe(true);
  });

  it("leaves a URL's path and a fenced code block alone", () => {
    const wrapper = mount(MarkdownText, {
      props: { source: "see https://example.com/docs/a.md\n\n```\nsrc/a.ts\n```" },
    });
    expect(wrapper.findAll("a.file-link")).toHaveLength(0);
    expect(wrapper.get("a").attributes("href")).toBe("https://example.com/docs/a.md");
  });

  it("the plain variant (what the person typed) links paths too", () => {
    const wrapper = mount(MarkdownText, {
      props: { source: "open src/pricing.ts please", variant: "plain" },
    });
    expect(wrapper.get("a.file-link").text()).toBe("src/pricing.ts");
  });
});
