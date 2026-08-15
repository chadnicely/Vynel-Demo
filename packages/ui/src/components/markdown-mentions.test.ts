import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MarkdownText from "./MarkdownText.vue";

function render(source: string) {
  return mount(MarkdownText, { props: { source } });
}

// The canvas paints `@mention` as an accent chip. The grammar is the
// composer's own (`replaceMentions`), so what a thread shows as a mention is
// exactly what was parsed as one — these cases pin the places a naive pass
// over the rendered HTML would get it wrong.
describe("MarkdownText mention chips", () => {
  it("chips a mention in prose", () => {
    const wrapper = render("Asked @Letterman for read access.");
    const chip = wrapper.get(".mention-chip");

    expect(chip.text()).toBe("@Letterman");
    expect(wrapper.text()).toContain("Asked @Letterman for read access.");
  });

  it("chips a kebab agent slug, and stops at a trailing hyphen", () => {
    expect(render("ask @code-reviewer now").get(".mention-chip").text()).toBe(
      "@code-reviewer",
    );
    expect(render("ask @fix- now").get(".mention-chip").text()).toBe("@fix");
  });

  // An address is not a mention. The grammar fires only at a word boundary.
  it("leaves an email address alone", () => {
    const wrapper = render("mail chad@acme.com about it");

    expect(wrapper.find(".mention-chip").exists()).toBe(false);
    expect(wrapper.text()).toContain("chad@acme.com");
  });

  // Inside code an `@` is literal — a decorator, an npm scope, a shell flag.
  it("leaves code spans and fences untouched", () => {
    const inline = render("run `npm i @vynel/ui` first");
    expect(inline.find(".mention-chip").exists()).toBe(false);
    expect(inline.get("code").text()).toBe("npm i @vynel/ui");

    const fence = render("```ts\n@Component({})\nclass A {}\n```");
    expect(fence.find(".mention-chip").exists()).toBe(false);
    expect(fence.text()).toContain("@Component");
  });

  // The pass walks text runs; a mention in an href would corrupt the link.
  it("never rewrites inside a tag's attributes", () => {
    const wrapper = render("[write](mailto:chad@acme.com)");
    const link = wrapper.get("a");

    expect(link.attributes("href")).toBe("mailto:chad@acme.com");
    expect(wrapper.find(".mention-chip").exists()).toBe(false);
  });

  it("chips prose that follows a code span in the same paragraph", () => {
    const wrapper = render("`npm i @vynel/ui`, then ping @Sarah");

    expect(wrapper.findAll(".mention-chip")).toHaveLength(1);
    expect(wrapper.get(".mention-chip").text()).toBe("@Sarah");
  });

  it("chips every mention in one line", () => {
    const wrapper = render("@Sarah and @Noah both");

    expect(wrapper.findAll(".mention-chip").map((c) => c.text())).toEqual([
      "@Sarah",
      "@Noah",
    ]);
  });
});
