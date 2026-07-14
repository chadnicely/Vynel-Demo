import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CommandPalette from "./CommandPalette.vue";

const commands = [
  { id: "new-chat", label: "New chat", group: "Assistant" },
  { id: "new-workspace", label: "New workspace", group: "Assistant" },
  {
    id: "toggle-theme",
    label: "Toggle theme",
    group: "View",
    keywords: "dark light appearance",
  },
];

async function openPalette() {
  const wrapper = mount(CommandPalette, {
    props: { commands, open: true },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CommandPalette", () => {
  it("renders every command (with group headings) when open", async () => {
    await openPalette();
    const items = document.body.querySelectorAll("[data-index]");
    expect(items).toHaveLength(3);
    expect(document.body.textContent).toContain("Assistant");
    expect(document.body.textContent).toContain("View");
  });

  it("filters by query across label and keywords", async () => {
    const wrapper = await openPalette();
    const input = document.body.querySelector("input");
    expect(input).not.toBeNull();

    input!.value = "appearance";
    input!.dispatchEvent(new Event("input"));
    await wrapper.vm.$nextTick();

    const items = document.body.querySelectorAll("[data-index]");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("Toggle theme");
  });

  it("selects the highlighted command on Enter and closes", async () => {
    const wrapper = await openPalette();
    const input = document.body.querySelector("input")!;

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await wrapper.vm.$nextTick();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("select")).toEqual([["new-workspace"]]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("shows the empty state when nothing matches", async () => {
    const wrapper = await openPalette();
    const input = document.body.querySelector("input")!;
    input.value = "zzzz-nope";
    input.dispatchEvent(new Event("input"));
    await wrapper.vm.$nextTick();

    expect(document.body.querySelectorAll("[data-index]")).toHaveLength(0);
    expect(document.body.textContent).toContain("No matches.");
  });
});
