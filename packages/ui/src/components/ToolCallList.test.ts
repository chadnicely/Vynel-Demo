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

// The classifier-deny card's re-authorize rides through the list: the host's
// `reauthorizable` reaches every card, and a card's click comes back WITH the
// call (the host needs its tool name to phrase the re-issued message).
describe("ToolCallList — re-authorizing a blocked call", () => {
  const blockedCall = makeToolCall({
    id: "tc-blocked",
    toolUseId: "tu-blocked",
    toolName: "Bash",
    toolInput: { command: "crontab -" },
    toolOutput: { blockedBy: "classifier", reason: "no clear intent", message: "STOP" },
    status: "blocked",
    isErrorResult: true,
  });

  it("re-emits the card's reauthorize with the blocked call when the host allows it", async () => {
    const wrapper = mount(ToolCallList, {
      props: { toolCalls: [blockedCall], reauthorizable: true },
    });

    await wrapper.get(".reauthorize-button").trigger("click");

    expect(wrapper.emitted("reauthorize")).toEqual([[blockedCall]]);
  });

  it("keeps the button disabled when the host passes nothing (a turn may be streaming)", () => {
    const wrapper = mount(ToolCallList, {
      props: { toolCalls: [blockedCall] },
    });

    expect(wrapper.get(".reauthorize-button").attributes("disabled")).toBeDefined();
  });

  it("reaches a card inside a collapsed same-tool group too", async () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({ id: "tc-a", toolUseId: "tu-a", toolName: "Bash", toolInput: { command: "ls" } }),
          blockedCall,
        ],
        reauthorizable: true,
      },
    });

    await wrapper.get(".reauthorize-button").trigger("click");

    expect(wrapper.emitted("reauthorize")).toEqual([[blockedCall]]);
  });
});
