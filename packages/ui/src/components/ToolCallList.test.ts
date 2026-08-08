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

// The delegation chip was RETIRED (Chad, 2026-08-09): it duplicated the thread
// pointer under the message, which is the one tracker — live and settled. The
// dispatch card renders nothing extra even when the enrichment rides along.
describe("ToolCallList — no delegation chip (the pointer is the tracker)", () => {
  it("renders no chip even on a fully enriched dispatch call", () => {
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
              workspaceId: "w1",
              targetSessionId: null,
            },
          }),
        ],
      },
    });

    expect(wrapper.find(".delegation-chip").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Summarize the pricing docs");
  });
});
