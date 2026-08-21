// Prose on the board — and the one renderer that turns model output into DOM.
// The sanitizer is the point: what Claude writes came from a tool result, so
// markup inside the body must stay text and never become an element.
//
// Assertions read TEXT and later blocks rather than the first element: under
// happy-dom, DOMPurify hands back the leading block's children without its
// wrapper tag (a heading arrives as bare text). Real browsers keep it; the
// sanitizing this test is actually about is identical either way.

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DisplayMarkdownWidget from "./DisplayMarkdownWidget.vue";

async function mountBody(body: string) {
  const wrapper = mount(DisplayMarkdownWidget, {
    props: { content: { kind: "markdown", body } },
  });
  await flushPromises();
  return wrapper;
}

describe("DisplayMarkdownWidget", () => {
  it("renders the body as markdown", async () => {
    const wrapper = await mountBody("Weekly runs\n\n- eleven green\n- one red");

    expect(wrapper.text()).toContain("Weekly runs");
    expect(wrapper.findAll("li").map((item) => item.text())).toEqual([
      "eleven green",
      "one red",
    ]);
  });

  it("keeps a script in the body out of the DOM while still rendering the prose", async () => {
    const wrapper = await mountBody(
      "## Report\n\n<script>window.stolen = 1</script>\n\nall good",
    );

    // Both halves matter: a renderer that drew NOTHING would also pass the
    // "no script" half, and pass for the wrong reason.
    expect(wrapper.text()).toContain("Report");
    expect(wrapper.text()).toContain("all good");
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.html()).not.toContain("<script");
  });

  it("keeps an event-handler tag out of the DOM", async () => {
    const wrapper = await mountBody('<img src="x" onerror="alert(1)">');

    // The tag survives as TEXT (that is what escaping means), so the check is
    // that no element carries the handler.
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("onerror");
  });

  it("refuses a javascript: link", async () => {
    const wrapper = await mountBody("[tap](javascript:alert(1))");

    expect(wrapper.find("a").exists()).toBe(false);
  });
});
