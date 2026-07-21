import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";
import { createActiveTurnView } from "../../composables/chat/active-turn-view.js";
import type { ActiveTurnView } from "../../composables/chat/active-turn-view.js";
import ThreadStream from "./ThreadStream.vue";

function makeMessage(index: number): ChatMessageResponse {
  return {
    id: `m${index}`,
    sessionId: "s1",
    role: index % 2 === 0 ? "user" : "assistant",
    body: `message ${index}`,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: "2026-07-05T10:00:00.000Z",
    completedAt: "2026-07-05T10:00:01.000Z",
    createdAt: "2026-07-05T10:00:00.000Z",
  };
}

function makeAgentToolCall(parentMessageId: string): ChatToolCallResponse {
  return {
    id: `tc-${parentMessageId}`,
    parentMessageId,
    toolUseId: `tu-${parentMessageId}`,
    toolName: "Agent",
    toolInput: { name: "scout", description: "Find the pricing rules" },
    toolOutput: "done",
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    startedAt: "2026-07-05T10:00:00.000Z",
    completedAt: "2026-07-05T10:00:30.000Z",
  };
}

function mountStream(messageCount: number) {
  return mount(ThreadStream, {
    props: {
      messages: Array.from({ length: messageCount }, (_, i) => makeMessage(i)),
      toolCallsByMessageId: {},
      activeTurn: null,
    },
    global: { plugins: [createPinia()] },
  });
}

describe("ThreadStream", () => {
  it("renders every message when the history fits the window", () => {
    const wrapper = mountStream(3);

    expect(wrapper.findAll(".message-row")).toHaveLength(3);
    expect(wrapper.find(".older-note").exists()).toBe(false);
  });

  it("windows long history to the newest 100 and offers the older rows", () => {
    const wrapper = mountStream(150);

    const rows = wrapper.findAll(".message-row");
    expect(rows).toHaveLength(100);
    // The newest message is the last row; the oldest 50 stay unrendered.
    expect(rows[rows.length - 1]!.text()).toContain("message 149");
    expect(rows[0]!.text()).toContain("message 50");
    expect(wrapper.find(".older-note").text()).toContain(
      "50 earlier messages",
    );
  });

  it("keeps the jump-to-latest pill hidden while pinned at the bottom", () => {
    const wrapper = mountStream(5);

    expect(wrapper.find(".jump-to-latest").exists()).toBe(false);
  });

  // ── Watch-chip PIPELINE scoping (Chad, 2026-07-21 evening) ──
  // A thread chips ONLY its direct children's work. The discriminator: a
  // delegation that TARGETED this thread left its task row here (role 'user'
  // + sourceKind 'global-root' + the trace key); work this thread SENT DOWN
  // arrives only as the pushed report row (assistant + 'workspace-manager',
  // no task row on the sender) — recordPushedReportMessage vs the routed
  // turn's messageAttribution.

  it("chips a SENT-DOWN report row (no task row for its trace) and emits its trace key", async () => {
    const report: ChatMessageResponse = {
      ...makeMessage(1),
      partialSessionId: "partial-1",
      sourceKind: "workspace-manager",
      sourceLabel: "Noah · vynel",
    };
    const wrapper = mount(ThreadStream, {
      props: { messages: [report], toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const chip = wrapper.get(".session-link");
    await chip.trigger("click");
    expect(wrapper.emitted("openSession")).toEqual([["partial-1"]]);
  });

  it("never chips the rows of a delegation that TARGETED this thread — that's the parent's watch", () => {
    // The global→workspace exchange as it lands on the WORKSPACE transcript:
    // the arriving task (user + 'global-root') and the manager's reply share
    // the trace key. Neither may chip — the chip belongs to the PARENT thread
    // that sent the task. A separate SENT trace ('partial-out', report row
    // only) keeps its chip on the very same surface.
    const arrivingTask: ChatMessageResponse = {
      ...makeMessage(0),
      role: "user",
      sourceKind: "global-root",
      partialSessionId: "partial-in",
    };
    const managerReply: ChatMessageResponse = {
      ...makeMessage(1),
      sourceKind: "workspace-manager",
      sourceLabel: "Sarah · letterman",
      partialSessionId: "partial-in",
    };
    const sentDownReport: ChatMessageResponse = {
      ...makeMessage(3),
      sourceKind: "workspace-manager",
      sourceLabel: "Research helper",
      partialSessionId: "partial-out",
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [arrivingTask, managerReply, sentDownReport],
        toolCallsByMessageId: {},
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    const chips = wrapper.findAll(".session-link");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toContain("Research helper");
  });

  it("agent chips SURVIVE on a received trace's rows — an agent is a direct child", async () => {
    // Scoping suppresses the trace chip, never the agent chip: the manager's
    // own agents belong to THIS thread's pipeline level.
    const arrivingTask: ChatMessageResponse = {
      ...makeMessage(0),
      role: "user",
      sourceKind: "global-root",
      partialSessionId: "partial-in",
    };
    const managerReply: ChatMessageResponse = {
      ...makeMessage(1),
      sourceKind: "workspace-manager",
      sourceLabel: "Sarah · letterman",
      partialSessionId: "partial-in",
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [arrivingTask, managerReply],
        toolCallsByMessageId: { m1: [makeAgentToolCall("m1")] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.findAll(".session-link")).toHaveLength(0);
    await wrapper.get(".watch-chip").trigger("click");
    expect(wrapper.emitted("watchAgent")).toEqual([
      [{ kind: "trace", id: "partial-in" }, "tu-m1"],
    ]);
  });

  it("show-watch-chips=false (a SESSION view, pipeline leaf) drops every trace chip but keeps agent chips", () => {
    // Scoping rule 3: a session view shows agent chips ONLY — even a report
    // row that would chip on a thread surface stays bare here.
    const report: ChatMessageResponse = {
      ...makeMessage(1),
      partialSessionId: "partial-1",
      sourceKind: "workspace-manager",
      sourceLabel: "Research helper",
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [report],
        toolCallsByMessageId: { m1: [makeAgentToolCall("m1")] },
        activeTurn: null,
        showWatchChips: false,
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.find(".session-link").exists()).toBe(false);
    expect(wrapper.find(".watch-chip").exists()).toBe(true);
  });

  it("a traced row's Agent card watches over the TRACE source", async () => {
    const traced: ChatMessageResponse = {
      ...makeMessage(1),
      partialSessionId: "partial-1",
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [traced],
        toolCallsByMessageId: { m1: [makeAgentToolCall("m1")] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    await wrapper.get(".watch-chip").trigger("click");
    expect(wrapper.emitted("watchAgent")).toEqual([
      [{ kind: "trace", id: "partial-1" }, "tu-m1"],
    ]);
  });

  it("a DIRECT turn's Agent card watches over the row's own SESSION source", async () => {
    // No partialSessionId — the agent's activity lives on the session the
    // turn ran on (persisted subagent fields / the live map).
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [makeMessage(1)],
        toolCallsByMessageId: { m1: [makeAgentToolCall("m1")] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    await wrapper.get(".watch-chip").trigger("click");
    expect(wrapper.emitted("watchAgent")).toEqual([
      [{ kind: "session", id: "s1" }, "tu-m1"],
    ]);
  });

  it("hides persisted rows the live overlay already renders (mid-turn refetch dedupe)", () => {
    // Rows persist per chunk, so a refetch during a turn returns the very
    // messages the overlay is streaming — they must not double-render.
    const history = [makeMessage(0), makeMessage(1), makeMessage(2), makeMessage(3)];
    const activeTurn: ActiveTurnView = {
      ...createActiveTurnView(),
      userMessage: history[2]!, // the turn's own user message, already persisted
      segments: [
        { messageId: "m3", text: "streaming reply…", thinking: "", toolCalls: [] },
      ],
    };
    const wrapper = mount(ThreadStream, {
      props: { messages: history, toolCallsByMessageId: {}, activeTurn },
      global: { plugins: [createPinia()] },
    });

    // Settled rows m0+m1 render from history; m2 (user) renders once via the
    // overlay; m3 renders only as the live turn.
    const rowTexts = wrapper.findAll(".message-row").map((row) => row.text());
    expect(rowTexts.filter((text) => text.includes("message 2"))).toHaveLength(1);
    expect(rowTexts.some((text) => text.includes("message 3"))).toBe(false);
    expect(wrapper.text()).toContain("streaming reply…");
  });
});
