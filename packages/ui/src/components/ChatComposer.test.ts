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

  it("a host can write the draft from outside (dictation) and it still sends", async () => {
    const wrapper = mount(ChatComposer, {
      props: { ...baseProps, draft: "spoken words" },
    });

    const input = wrapper.find("textarea");
    expect((input.element as HTMLTextAreaElement).value).toBe("spoken words");

    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")).toEqual([["spoken words", []]]);
    expect(wrapper.emitted("update:draft")?.at(-1)).toEqual([""]);
  });

  it("the mic pulses while dictating and reads as a stop control", async () => {
    const wrapper = mount(ChatComposer, {
      props: { ...baseProps, showVoice: true, voiceActive: true },
    });

    const mic = wrapper.find('[aria-label="Stop dictating"]');
    expect(mic.classes()).toContain("is-voice-active");

    await mic.trigger("click");
    expect(wrapper.emitted("voice")).toHaveLength(1);
  });

  it("shows the thinking chip only when efforts are provided, and emits the pick", async () => {
    const bare = mount(ChatComposer, { props: baseProps });
    expect(bare.find('[aria-label="Thinking"]').exists()).toBe(false);

    const wrapper = mount(ChatComposer, {
      props: {
        ...baseProps,
        efforts: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
        effortId: "low",
      },
    });

    await wrapper.find('[aria-label="Thinking"]').trigger("click");
    const rows = wrapper.findAll(".menu-row");
    await rows[1]!.trigger("click");

    expect(wrapper.emitted("update:effortId")).toEqual([["high"]]);
  });

  it("shows the context ring only when the host passes an occupancy", () => {
    const bare = mount(ChatComposer, { props: baseProps });
    expect(bare.find(".context-ring").exists()).toBe(false);

    const wrapper = mount(ChatComposer, {
      props: {
        ...baseProps,
        contextFraction: 0.83,
        contextTooltip: "~166k of 200k · continues automatically near 85%",
      },
    });

    const ring = wrapper.get(".context-ring");
    expect(ring.classes()).toContain("is-warn");
    expect(ring.attributes("title")).toBe(
      "~166k of 200k · continues automatically near 85%",
    );
  });

  it("renders the notice line when the host passes one", () => {
    const wrapper = mount(ChatComposer, {
      props: { ...baseProps, notice: "Microphone access was denied." },
    });
    expect(wrapper.find(".composer-notice").text()).toBe(
      "Microphone access was denied.",
    );
  });

  it("pasting files attaches them instead of inserting text", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const file = new File(["png-bytes"], "screenshot.png", {
      type: "image/png",
    });

    await wrapper.find("textarea").trigger("paste", {
      clipboardData: { files: [file] },
    });

    expect(wrapper.find(".attachment-chip").text()).toContain("screenshot.png");
  });

  it("dropping files onto the composer attaches them", async () => {
    const wrapper = mount(ChatComposer, { props: baseProps });
    const file = new File(["pdf-bytes"], "report.pdf", {
      type: "application/pdf",
    });

    await wrapper.find(".chat-composer").trigger("drop", {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    expect(wrapper.find(".attachment-chip").text()).toContain("report.pdf");
  });

  it("allowAttachments=false hides the attach affordance and rejects pasted/dropped files", async () => {
    const wrapper = mount(ChatComposer, {
      props: { ...baseProps, allowAttachments: false },
    });

    // No attach button, no hidden file input — the affordance is gone, so a
    // typed message can never be lost to an attachment the route rejects.
    expect(wrapper.find('[aria-label="Attach files"]').exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);

    const file = new File(["pdf-bytes"], "report.pdf", {
      type: "application/pdf",
    });
    await wrapper.find(".chat-composer").trigger("drop", {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    await wrapper.find("textarea").trigger("paste", {
      clipboardData: { files: [file] },
    });

    expect(wrapper.find(".attachment-chip").exists()).toBe(false);
    // The drop highlight never arms either.
    await wrapper.find(".chat-composer").trigger("dragenter", {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(wrapper.find(".chat-composer").classes()).not.toContain(
      "is-drop-target",
    );
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
