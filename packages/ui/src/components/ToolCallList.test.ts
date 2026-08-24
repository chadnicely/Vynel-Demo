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
// `reauthorizeState` reaches every card, and a card's click comes back WITH the
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
      props: { toolCalls: [blockedCall], reauthorizeState: "ready" },
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
        reauthorizeState: "ready",
      },
    });

    await wrapper.get(".reauthorize-button").trigger("click");

    expect(wrapper.emitted("reauthorize")).toEqual([[blockedCall]]);
  });
});

// The batch fold (Kafi 2026-08-25, the Claude-Desktop shape): the whole batch
// hides behind one count+hint line by default — the step line above it (the
// base instruction's narration rule) says what is happening. A blocked call
// forces the batch open: "Run it anyway" must never hide behind a fold.
describe("ToolCallList — the batch folds by default", () => {
  it("collapses to one header with the count and a one-line hint; expanding shows the cards", async () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({ id: "tc-a", toolUseId: "tu-a", toolName: "Bash", toolInput: { command: "ls" } }),
          makeToolCall({ id: "tc-b", toolUseId: "tu-b", toolName: "Bash", toolInput: { command: "git status" } }),
        ],
      },
    });

    expect(wrapper.find(".batch-body").exists()).toBe(false);
    expect(wrapper.find(".tool-call-card").exists()).toBe(false);
    expect(wrapper.get(".batch-header").text()).toContain("2 tool calls");
    // The hint is the LATEST call's one-liner.
    expect(wrapper.get(".batch-hint").text()).toContain("git status");

    await wrapper.get(".batch-header").trigger("click");
    expect(wrapper.find(".batch-body").exists()).toBe(true);

    await wrapper.get(".batch-header").trigger("click");
    expect(wrapper.find(".batch-body").exists()).toBe(false);
  });

  it("a single call folds too, labelled in the singular", () => {
    const wrapper = mount(ToolCallList, {
      props: { toolCalls: [makeToolCall()] },
    });

    expect(wrapper.get(".batch-header").text()).toContain("1 tool call");
    expect(wrapper.find(".tool-call-card").exists()).toBe(false);
  });

  it("a blocked call opens the batch by itself, and the user can still fold it", async () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({
            id: "tc-blocked-2",
            toolUseId: "tu-blocked-2",
            toolName: "Bash",
            toolInput: { command: "rm -rf /" },
            status: "blocked",
            isErrorResult: true,
          }),
        ],
      },
    });

    expect(wrapper.find(".batch-body").exists()).toBe(true);

    await wrapper.get(".batch-header").trigger("click");
    expect(wrapper.find(".batch-body").exists()).toBe(false);
  });

  it("while a call runs, the hint follows the RUNNING call and stays folded", () => {
    const wrapper = mount(ToolCallList, {
      props: {
        toolCalls: [
          makeToolCall({ id: "tc-done", toolUseId: "tu-done", toolName: "Bash", toolInput: { command: "ls" } }),
          makeToolCall({
            id: "tc-live",
            toolUseId: "tu-live",
            toolName: "Bash",
            toolInput: { command: "pnpm test" },
            status: "started",
            completedAt: null,
          }),
        ],
      },
    });

    expect(wrapper.find(".batch-body").exists()).toBe(false);
    expect(wrapper.get(".batch-hint").text()).toContain("pnpm test");
  });
});
