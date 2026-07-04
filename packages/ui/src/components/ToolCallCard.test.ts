import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import ToolCallCard from "./ToolCallCard.vue";

function makeToolCall(
  overrides: Partial<ChatToolCallResponse> = {},
): ChatToolCallResponse {
  return {
    id: "tc-1",
    parentMessageId: "msg-1",
    toolUseId: "tu-1",
    toolName: "Read",
    toolInput: { file_path: "src/pricing.ts" },
    toolOutput: "export const price = 49",
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    startedAt: "2026-07-05T10:00:00.000Z",
    completedAt: "2026-07-05T10:00:01.500Z",
    ...overrides,
  };
}

describe("ToolCallCard", () => {
  it("shows the verb, argument, status, and duration collapsed", () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall() },
    });

    expect(wrapper.find(".verb").text()).toBe("Read");
    expect(wrapper.find(".argument").text()).toBe("pricing.ts");
    expect(wrapper.text()).toContain("completed");
    expect(wrapper.text()).toContain("1.5s");
    expect(wrapper.find(".detail").exists()).toBe(false);
  });

  it("expands a Read into the file path and its content", async () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall() },
    });

    await wrapper.find(".summary").trigger("click");

    expect(wrapper.find(".subtitle").text()).toBe("src/pricing.ts");
    expect(wrapper.find(".code-block").text()).toContain(
      "export const price = 49",
    );
  });

  it("expands an Edit into before/after panes", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "Edit",
          toolInput: {
            file_path: "site/pricing.md",
            old_string: "Pro — $39/mo",
            new_string: "Pro — $49/mo",
          },
        }),
      },
    });

    await wrapper.find(".summary").trigger("click");

    const panes = wrapper.findAll(".diff-pane");
    expect(panes).toHaveLength(2);
    expect(panes[0]!.text()).toContain("$39/mo");
    expect(panes[1]!.text()).toContain("$49/mo");
  });

  it("expands a Bash into a terminal with prompt and output", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "Bash",
          toolInput: { command: "npm run build" },
          toolOutput: "✓ built in 1.9s",
        }),
      },
    });

    await wrapper.find(".summary").trigger("click");

    expect(wrapper.find(".terminal-command").text()).toContain("npm run build");
    expect(wrapper.find(".terminal-output").text()).toContain(
      "✓ built in 1.9s",
    );
  });

  it("falls back to payload panes for unknown tools", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "mcp__vynel__search_knowledge",
          toolInput: { query: "invoices" },
          toolOutput: { hits: 3 },
        }),
      },
    });

    await wrapper.find(".summary").trigger("click");

    const payloads = wrapper.findAll(".payload-body");
    expect(payloads[0]!.text()).toContain("invoices");
    expect(payloads[1]!.text()).toContain("hits");
  });

  it("renders a running tool with the live presence pulse", () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({ status: "started", completedAt: null }),
      },
    });

    expect(wrapper.find(".presence-dot.is-live").exists()).toBe(true);
    expect(wrapper.text()).toContain("running");
  });

  it("marks a denied tool call as an error tone", () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall({ status: "denied" }) },
    });

    expect(wrapper.find(".status-dot.tone-error").exists()).toBe(true);
  });
});
