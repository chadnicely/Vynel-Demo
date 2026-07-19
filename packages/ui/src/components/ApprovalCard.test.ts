import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ApprovalCard from "./ApprovalCard.vue";

describe("ApprovalCard", () => {
  it("emits approve/deny from the buttons", async () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        toolName: "Edit",
        toolInput: { file_path: "pricing.md" },
        actionKind: "file-edit",
      },
    });

    await wrapper.find(".action.approve").trigger("click");
    await wrapper.find(".action.deny").trigger("click");

    expect(wrapper.emitted("approve")).toHaveLength(1);
    expect(wrapper.emitted("deny")).toHaveLength(1);
  });

  it("describes the action in plain language and shows the input", () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        toolName: "Bash",
        toolInput: "rm -rf dist",
        actionKind: "shell-command",
        contextLabel: "Marketing site",
      },
    });

    expect(wrapper.text()).toContain(
      "wants to run a command in Marketing site",
    );
    expect(wrapper.find(".input-preview").text()).toBe("rm -rf dist");
    expect(wrapper.classes()).toContain("is-danger");
  });

  it("disables both buttons while busy", () => {
    const wrapper = mount(ApprovalCard, {
      props: { toolName: "Write", toolInput: {}, busy: true },
    });

    expect(
      wrapper.find(".action.approve").attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find(".action.deny").attributes("disabled")).toBeDefined();
  });

  it("promotes the input's description to the headline; the sentence demotes to a context line", () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        toolName: "Bash",
        toolInput: {
          command: "ls src/schemas",
          description: "Inspect sibling derived-state schemas",
        },
        actionKind: "shell-command",
        contextLabel: "Ks Tournalink",
      },
    });

    expect(wrapper.find(".headline").text()).toBe(
      "Inspect sibling derived-state schemas",
    );
    expect(wrapper.find(".context-line").text()).toBe(
      "Your assistant wants to run a command in Ks Tournalink",
    );
  });

  it("shows a shell approval's command as a terminal line, not a JSON blob — and hides nothing else", () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        toolName: "Bash",
        toolInput: {
          command: "npm run build",
          description: "Build the site",
          timeout: 120000,
        },
        actionKind: "shell-command",
      },
    });

    expect(wrapper.find(".command-line").text()).toBe("$ npm run build");
    // description is the title, command is the terminal line — the REMAINING
    // fields still show (colored JSON): the trust card omits nothing.
    const json = wrapper.find(".input-json");
    expect(json.text()).toContain("timeout");
    expect(json.text()).not.toContain("description");
    expect(json.text()).not.toContain("npm run build");
    expect(wrapper.find(".input-preview").exists()).toBe(false);
  });

  it("an EMPTY command is never promoted away — it stays visible in the JSON pane", () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        toolName: "Bash",
        toolInput: { command: "", description: "Run cleanup" },
        actionKind: "shell-command",
      },
    });

    // No terminal line to render — but the empty command must still SHOW
    // (an empty command means something upstream broke; the user deciding
    // trust needs to see that).
    expect(wrapper.find(".command-line").exists()).toBe(false);
    expect(wrapper.find(".input-json").text()).toContain('"command"');
  });

  it("keeps the sentence headline and colored-JSON input when there is no description", () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        toolName: "Write",
        toolInput: { file_path: "notes.md", content: "hello" },
        actionKind: "file-write",
      },
    });

    expect(wrapper.find(".headline").text()).toBe(
      "Your assistant wants to create a file",
    );
    expect(wrapper.find(".context-line").exists()).toBe(false);
    expect(wrapper.find(".input-json").text()).toContain("notes.md");
  });
});
