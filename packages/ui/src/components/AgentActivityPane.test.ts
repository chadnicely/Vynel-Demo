// The nested agent-activity pane + its ToolCallList integration: a card whose
// toolUseId has live activity gets the pane; others don't.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import AgentActivityPane from "./AgentActivityPane.vue";
import ToolCallList from "./ToolCallList.vue";

const agentCall: ChatToolCallResponse = {
  id: "tc-agent",
  parentMessageId: "m1",
  toolUseId: "tu_agent_1",
  toolName: "Agent",
  toolInput: { name: "researcher", description: "sweep the docs", prompt: "go" },
  toolOutput: null,
  status: "started",
  approvalStatus: null,
  isErrorResult: false,
  startedAt: "2026-07-19T10:00:00.000Z",
  completedAt: null,
};

describe("AgentActivityPane", () => {
  it("lists the agent's tool calls with status and streams its narrative", () => {
    const wrapper = mount(AgentActivityPane, {
      props: {
        activity: {
          text: "Reading the pricing file…",
          toolCalls: [
            {
              toolUseId: "tu_sub_read",
              toolName: "Read",
              toolInput: { file_path: "docs/pricing.md" },
              status: "started" as const,
            },
          ],
        },
      },
    });

    expect(wrapper.text()).toContain("Agent activity");
    expect(wrapper.text()).toContain("Read docs/pricing.md");
    expect(wrapper.text()).toContain("Reading the pricing file…");
    expect(wrapper.find(".call-status.is-started").exists()).toBe(true);
  });
});

describe("ToolCallList agent nesting", () => {
  it("nests the pane under the Agent card whose toolUseId has activity", () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [agentCall],
        agentActivity: {
          tu_agent_1: {
            text: "on it",
            toolCalls: [],
          },
        },
      },
    });
    expect(wrapper.find(".agent-activity").exists()).toBe(true);
    expect(wrapper.text()).toContain("on it");
  });

  it("renders no pane without matching activity", () => {
    const wrapper = mount(ToolCallList, {
      props: { toolCalls: [agentCall] },
    });
    expect(wrapper.find(".agent-activity").exists()).toBe(false);
  });
});
