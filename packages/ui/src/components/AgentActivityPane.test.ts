// The agent-activity pane (the Watch focused view's body) + ToolCallList's
// in-thread integration: a RUNNING Agent card gets a one-line live ticker —
// its latest action only; the full pane never renders in the thread.

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

describe("ToolCallList agent ticker", () => {
  it("a RUNNING Agent card shows a one-line ticker with its LATEST action only", () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [agentCall],
        agentActivity: {
          tu_agent_1: {
            text: "sweeping…",
            toolCalls: [
              {
                toolUseId: "tu_sub_1",
                toolName: "Read",
                toolInput: { file_path: "docs/old.md" },
                status: "completed" as const,
              },
              {
                toolUseId: "tu_sub_2",
                toolName: "Grep",
                toolInput: { pattern: "pricing" },
                status: "started" as const,
              },
            ],
          },
        },
      },
    });
    const ticker = wrapper.find(".agent-ticker");
    expect(ticker.exists()).toBe(true);
    expect(ticker.text()).toContain("Grep pricing");
    expect(ticker.text()).not.toContain("docs/old.md");
    // The full pane never renders in the thread — Watch is the way in.
    expect(wrapper.find(".agent-activity").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("sweeping…");
  });

  it("shows a plain working note before the agent's first tool", () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [agentCall],
        agentActivity: { tu_agent_1: { text: "on it", toolCalls: [] } },
      },
    });
    expect(wrapper.find(".agent-ticker").text()).toContain("Working…");
  });

  it("a RUNNING card with no live map falls back to its persisted latest action (mid-run reload)", () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          {
            ...agentCall,
            subagentToolCalls: [
              {
                toolUseId: "tu_sub_1",
                toolName: "Read",
                toolInput: { file_path: "docs/pricing.md" },
                status: "started",
                startedAt: "2026-07-19T10:00:10.000Z",
                completedAt: null,
              },
            ],
          },
        ],
      },
    });
    expect(wrapper.find(".agent-ticker").text()).toContain("Read docs/pricing.md");
  });

  it("no ticker without any activity, and none once the card settles", () => {
    expect(
      mount(ToolCallList, { props: { toolCalls: [agentCall] } })
        .find(".agent-ticker")
        .exists(),
    ).toBe(false);
    const settledAgentCall: ChatToolCallResponse = {
      ...agentCall,
      status: "completed",
      completedAt: "2026-07-19T10:01:00.000Z",
      subagentNarrative: "swept the docs.",
      subagentToolCalls: [
        {
          toolUseId: "tu_sub_read",
          toolName: "Read",
          toolInput: { file_path: "docs/pricing.md" },
          status: "completed",
          startedAt: "2026-07-19T10:00:10.000Z",
          completedAt: "2026-07-19T10:00:12.000Z",
        },
      ],
    };
    // Even with a lingering live map entry AND persisted fields, a settled
    // card shows nothing in-line — the recorded activity lives behind Watch.
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [settledAgentCall],
        agentActivity: { tu_agent_1: { text: "tail", toolCalls: [] } },
      },
    });
    expect(wrapper.find(".agent-ticker").exists()).toBe(false);
    expect(wrapper.find(".agent-activity").exists()).toBe(false);
  });
});

describe("ToolCallList agent watch chip", () => {
  it("shows Watch on Agent cards when watchable-agents and emits the call", async () => {
    const wrapper = mount(ToolCallList, {
      props: { toolCalls: [agentCall], watchableAgents: true },
    });
    const chip = wrapper.find(".watch-chip");
    expect(chip.exists()).toBe(true);
    await chip.trigger("click");
    expect(wrapper.emitted("watchAgent")).toEqual([[agentCall]]);
  });

  it("no chip without the flag, and never on non-agent cards", () => {
    expect(
      mount(ToolCallList, { props: { toolCalls: [agentCall] } })
        .find(".watch-chip")
        .exists(),
    ).toBe(false);
    expect(
      mount(ToolCallList, {
        props: {
          toolCalls: [{ ...agentCall, toolName: "Read" }],
          watchableAgents: true,
        },
      })
        .find(".watch-chip")
        .exists(),
    ).toBe(false);
  });
});
