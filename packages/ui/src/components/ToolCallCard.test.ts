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
  it("shows the verb, argument, and duration collapsed — no status word on a clean run", () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall() },
    });

    expect(wrapper.find(".verb").text()).toBe("Read");
    expect(wrapper.find(".argument").text()).toBe("pricing.ts");
    expect(wrapper.text()).toContain("1.5s");
    // A clean completion is told by the dot, not spelled out.
    expect(wrapper.text()).not.toContain("completed");
    expect(wrapper.find(".detail").exists()).toBe(false);
  });

  it("expands a Read into the file-path header and its content", async () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall() },
    });

    await wrapper.find(".summary").trigger("click");

    expect(wrapper.find(".file-path").text()).toBe("src/pricing.ts");
    expect(wrapper.find(".code-block").text()).toContain(
      "export const price = 49",
    );
  });

  it("expands an Edit into a unified diff with ± stats on the chip", async () => {
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

    expect(wrapper.find(".stat-added").text()).toBe("+1");
    expect(wrapper.find(".stat-removed").text()).toBe("-1");

    await wrapper.find(".summary").trigger("click");

    expect(wrapper.find(".diff-block.is-removed").text()).toContain("$39/mo");
    expect(wrapper.find(".diff-block.is-added").text()).toContain("$49/mo");
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

  it("humanizes an MCP tool's name and falls back to payload panes", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "mcp__vynel__search_knowledge",
          toolInput: { query: "invoices", limit: 3 },
          toolOutput: { hits: 3 },
        }),
      },
    });

    expect(wrapper.find(".verb").text()).toBe("search knowledge");

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
