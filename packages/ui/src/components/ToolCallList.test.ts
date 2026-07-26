import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import ToolCallList from "./ToolCallList.vue";

function makeToolCall(
  overrides: Partial<ChatToolCallResponse> = {},
): ChatToolCallResponse {
  return {
    id: "tc1",
    parentMessageId: "m1",
    toolUseId: "tu1",
    toolName: "mcp__vynel__send_message",
    toolInput: { to: "workspace:w1", message: "do the thing" },
    toolOutput: '{"jobId":"j1","deliveredTo":"Acme"}',
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    startedAt: "2026-07-27T10:00:00.000Z",
    completedAt: "2026-07-27T10:00:01.000Z",
    ...overrides,
  };
}

// The delegation chip is the PERSISTENT door to a dispatch call's delegation
// (Chad's 2026-07-27 smoke: once the job settled, no affordance survived to
// open its trace). It renders from the serve-time `delegation` enrichment,
// live or settled, and opens the trace via openDelegation.
describe("ToolCallList — the delegation chip", () => {
  it("renders the settled outcome and emits openDelegation with the trace key", async () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({
            delegation: {
              jobId: "j1",
              partialSessionId: "trace-1",
              status: "completed",
              deliveredTo: "Acme",
              taskLabel: "Summarize the pricing docs",
              reportedAt: "2026-07-27T10:05:00.000Z",
              completedAt: "2026-07-27T10:05:01.000Z",
            },
          }),
        ],
      },
    });

    const chip = wrapper.find(".delegation-chip");
    expect(chip.text()).toContain("Acme · Summarize the pricing docs");
    expect(chip.text()).toContain("done · report delivered");
    await chip.trigger("click");
    expect(wrapper.emitted("openDelegation")).toEqual([["trace-1"]]);
  });

  it("reads as working while the job is in flight", () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({
            delegation: {
              jobId: "j1",
              partialSessionId: "trace-1",
              status: "claimed",
              deliveredTo: "Acme",
              taskLabel: null,
              reportedAt: null,
              completedAt: null,
            },
          }),
        ],
      },
    });

    expect(wrapper.find(".delegation-chip").text()).toContain("Acme — working…");
  });

  // PIPELINE SCOPING (Chad, locked 2026-07-27): ONE chip — the direct hop.
  // Deeper hops surface inside the opened watch panel, never here.
  it("renders exactly one chip regardless of how far the chain grew", () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({
            delegation: {
              jobId: "j1",
              partialSessionId: "trace-ws",
              status: "completed",
              deliveredTo: "letterman",
              taskLabel: "Get the architecture",
              reportedAt: "2026-07-27T10:03:00.000Z",
              completedAt: "2026-07-27T10:05:01.000Z",
            },
          }),
        ],
      },
    });

    const chips = wrapper.findAll(".delegation-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toContain("letterman · Get the architecture");
  });

  it("renders no chip without the enrichment or without a trace key", () => {
    const unenriched = mount(ToolCallList, {
      props: { toolCalls: [makeToolCall()] },
    });
    expect(unenriched.find(".delegation-chip").exists()).toBe(false);

    const keyless = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({
            delegation: {
              jobId: "j1",
              partialSessionId: null,
              status: "completed",
              deliveredTo: "Acme",
              taskLabel: null,
              reportedAt: null,
              completedAt: null,
            },
          }),
        ],
      },
    });
    expect(keyless.find(".delegation-chip").exists()).toBe(false);
  });
});
