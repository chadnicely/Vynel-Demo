// The composer's mention pickers (chat-mentions) — trigger detection wired to
// the live textarea, menu rendering, keyboard navigation, insertion, and the
// Enter-picks-never-sends interplay.

import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import ChatComposer from "./ChatComposer.vue";

const baseProps = {
  models: [{ id: "opus", label: "Opus" }],
  modelId: "opus",
  modes: [{ id: "ask", label: "Ask" }],
  modeId: "ask",
  mentionSuggestions: [
    { id: "a1", label: "Code Reviewer", hint: "agent", insert: "@code-reviewer", group: "Agents" },
    { id: "a2", label: "Researcher", hint: "agent", insert: "@researcher", group: "Agents" },
    { id: "p1", label: "Sarah · Acme", hint: "workspace manager", insert: "@Sarah", group: "People" },
  ],
  workspaceSuggestions: [
    { id: "w1", label: "Acme", insert: "#Acme", group: "Workspaces" },
    { id: "w2", label: "Q3 plans", insert: '#"Q3 plans"', group: "Workspaces" },
  ],
  slashSuggestions: [
    { id: "c1", label: "/deploy", insert: "/deploy", group: "Commands" },
    { id: "s1", label: "PDF skill", insert: "Use the pdf skill: ", group: "Skills" },
  ],
};

async function type(wrapper: ReturnType<typeof mount>, text: string) {
  const input = wrapper.find("textarea");
  await input.setValue(text);
  await nextTick(); // refreshSuggest defers one tick
  await nextTick();
  return input;
}

describe("ChatComposer mention pickers", () => {
  it("the bare @ pops the full mention menu with group labels", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    await type(wrapper, "@");

    const rows = wrapper.findAll(".suggest-row");
    expect(rows.map((row) => row.text())).toEqual([
      "Code Revieweragent",
      "Researcheragent",
      "Sarah · Acmeworkspace manager",
    ]);
    expect(wrapper.findAll(".group-label").map((l) => l.text())).toEqual([
      "Agents",
      "People",
    ]);
  });

  it("typing after the trigger filters the list", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    await type(wrapper, "@res");
    expect(wrapper.findAll(".suggest-row").map((row) => row.text())).toEqual([
      "Researcheragent",
    ]);
  });

  it("ArrowDown + Enter inserts the token and never sends", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const input = await type(wrapper, "hey @");

    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    await nextTick();

    expect(wrapper.emitted("send")).toBeUndefined();
    expect((input.element as HTMLTextAreaElement).value).toBe("hey @researcher ");
    // The menu is gone; a plain Enter now sends the composed message.
    expect(wrapper.find(".suggest-row").exists()).toBe(false);
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")).toEqual([["hey @researcher", []]]);
  });

  it("click-select inserts too (quoted workspace token verbatim)", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const input = await type(wrapper, "#q3");

    const rows = wrapper.findAll(".suggest-row");
    expect(rows).toHaveLength(1);
    await rows[0]!.trigger("click");
    await nextTick();
    expect((input.element as HTMLTextAreaElement).value).toBe('#"Q3 plans" ');
  });

  it("Escape dismisses the current token's menu; Enter then sends normally", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const input = await type(wrapper, "@cod");

    await input.trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(wrapper.find(".suggest-row").exists()).toBe(false);

    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")).toEqual([["@cod", []]]);
  });

  it("/ pops commands + skills at the message start only", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    await type(wrapper, "run /");
    expect(wrapper.find(".suggest-row").exists()).toBe(false);

    await type(wrapper, "/");
    expect(wrapper.findAll(".suggest-row").map((row) => row.text())).toEqual([
      "/deploy",
      "PDF skill",
    ]);
    expect(wrapper.findAll(".group-label").map((l) => l.text())).toEqual([
      "Commands",
      "Skills",
    ]);
  });

  it("an IME composition Enter neither picks nor sends (isComposing guard)", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const input = await type(wrapper, "@");
    expect(wrapper.find(".suggest-row").exists()).toBe(true);

    // Committing a CJK composition fires Enter with isComposing — the menu
    // must not pick and the composer must not send.
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    await nextTick();
    expect(wrapper.emitted("send")).toBeUndefined();
    expect((input.element as HTMLTextAreaElement).value).toBe("@");
    expect(wrapper.find(".suggest-row").exists()).toBe(true);

    // The same guard covers the plain send path (no menu open).
    await type(wrapper, "hello 日本語");
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.emitted("send")).toBeUndefined();
    // A real (post-composition) Enter still sends.
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")).toEqual([["hello 日本語", []]]);
  });

  it("without rosters the triggers stay inert (data-blind default)", async () => {
    const wrapper = mount(ChatComposer, {
      props: {
        models: baseProps.models,
        modelId: "opus",
        modes: baseProps.modes,
        modeId: "ask",
      },
    });
    await type(wrapper, "@");
    expect(wrapper.find(".suggest-row").exists()).toBe(false);
  });
});
