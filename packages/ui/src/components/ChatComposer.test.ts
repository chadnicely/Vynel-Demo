import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ChatComposer from "./ChatComposer.vue";

const baseProps = {
  models: [
    { id: "opus", label: "Opus 4.8" },
    { id: "sonnet", label: "Sonnet 5" },
  ],
  modelId: "opus",
  modes: [
    { id: "ask", label: "Ask" },
    { id: "auto", label: "Auto" },
  ],
  modeId: "ask",
};

describe("ChatComposer", () => {
  it("Enter sends the trimmed draft and clears it; Shift+Enter does not send", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const input = wrapper.find("textarea");

    await input.setValue("  hello there  ");
    await input.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(wrapper.emitted("send")).toBeUndefined();

    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")).toEqual([["hello there", []]]);
    expect((input.element as HTMLTextAreaElement).value).toBe("");
  });

  it("shows Stop while streaming and emits interrupt", async () => {
    const wrapper = mount(ChatComposer, {
      props: { ...baseProps, streaming: true },
    });

    await wrapper.find('[aria-label="Stop the current task"]').trigger("click");

    expect(wrapper.emitted("interrupt")).toHaveLength(1);
  });

  it("selecting a model through its chip emits update:modelId", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });

    await wrapper.find('[aria-label="Model"]').trigger("click");
    const rows = wrapper.findAll(".menu-row");
    await rows[1]!.trigger("click");

    expect(wrapper.emitted("update:modelId")).toEqual([["sonnet"]]);
  });

  it("picked files show as removable chips and ride the send", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const fileInput = wrapper.find('input[type="file"]');
    const file = new File(["hi"], "notes.md", { type: "text/markdown" });

    Object.defineProperty(fileInput.element, "files", { value: [file] });
    await fileInput.trigger("change");
    expect(wrapper.find(".attachment-chip").text()).toContain("notes.md");

    await wrapper.find("textarea").setValue("see attachment");
    await wrapper.find('[aria-label="Send message"]').trigger("click");

    const sendEvents = wrapper.emitted("send")!;
    expect(sendEvents[0]![0]).toBe("see attachment");
    expect((sendEvents[0]![1] as File[])[0]!.name).toBe("notes.md");
    expect(wrapper.find(".attachment-chip").exists()).toBe(false);
  });
});
