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
});
