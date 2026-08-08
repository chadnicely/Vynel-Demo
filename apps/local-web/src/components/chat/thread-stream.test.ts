import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { MessageRow } from "@vynel/ui";
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

  // ── Thread pointers (live-tracking redesign, Case 1): the tracker is a
  // pointer under the hand-off row — once per in-flight trace, sender-side
  // only, gone when the task settles (the map mirrors the poll). ──

  it("renders the pointer under the HAND-OFF row via its dispatch tool call's delegation key; click emits openPointer", async () => {
    // The PRODUCTION shape: sender-side message rows are unstamped — the work
    // trace key rides the dispatch tool call's served `delegation` (the
    // reviewer-caught fixture lesson: a row-stamped sender never exists live).
    const handOff = makeMessage(1);
    const dispatchCall: ChatToolCallResponse = {
      id: "tc-dispatch",
      parentMessageId: handOff.id,
      toolUseId: "tu-dispatch",
      toolName: "send_message",
      toolInput: { to: "workspace:invoices" },
      toolOutput: "queued",
      status: "completed",
      approvalStatus: null,
      isErrorResult: false,
      delegation: {
        jobId: "job-1",
        partialSessionId: "trace-1",
        status: "claimed",
        deliveredTo: "Invoices",
        taskLabel: "July invoicing",
        reportedAt: null,
        completedAt: null,
      },
      startedAt: "2026-07-05T10:00:00.000Z",
      completedAt: "2026-07-05T10:00:01.000Z",
    };
    const pointer = {
      partialSessionId: "trace-1",
      taskLabel: "July invoicing",
      targetLabel: "Noah · Invoices",
      status: "working" as const,
      targetSessionId: "seg-1",
      workspaceId: null,
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [makeMessage(0), handOff, makeMessage(2)],
        toolCallsByMessageId: { [handOff.id]: [dispatchCall] },
        activeTurn: null,
        pointersByTraceId: new Map([["trace-1", pointer]]),
      },
      global: { plugins: [createPinia()] },
    });

    const pointers = wrapper.findAll('[data-testid="thread-pointer"]');
    expect(pointers).toHaveLength(1);
    expect(pointers[0]!.text()).toContain("July invoicing");
    expect(pointers[0]!.text()).toContain("Noah · Invoices");
    await pointers[0]!.trigger("click");
    // The FULL pointer rides the emit — the host routes by its target.
    expect(wrapper.emitted("openPointer")).toEqual([[pointer]]);
  });

  it("a RECEIVED trace never grows a pointer — the target side has the anchor row, not a tracker", () => {
    const inboundTask: ChatMessageResponse = {
      ...makeMessage(0),
      role: "user",
      sourceKind: "global-root",
      partialSessionId: "trace-2",
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [inboundTask],
        toolCallsByMessageId: {},
        activeTurn: null,
        pointersByTraceId: new Map([
          [
            "trace-2",
            {
              partialSessionId: "trace-2",
              taskLabel: "Chase POs",
              targetLabel: "Invoices",
              status: "queued" as const,
              targetSessionId: null,
              workspaceId: "ws-1",
            },
          ],
        ]),
      },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.find('[data-testid="thread-pointer"]').exists()).toBe(false);
  });

  // ── Watch-chip PIPELINE scoping (Chad, 2026-07-21 evening) ──
  // A thread chips ONLY its direct children's work. The discriminator: a
  // delegation that TARGETED this thread left its task row here (role 'user'
  // + sourceKind 'global-root' + the trace key); work this thread SENT DOWN
  // arrives only as the pushed report row (assistant + 'workspace-manager',
  // no task row on the sender) — recordPushedReportMessage vs the routed
  // turn's messageAttribution.

  it("a chip pulses LIVE only while its trace key is in liveTraceIds (B1 — the in-flight poll)", () => {
    const sent: ChatMessageResponse = {
      ...makeMessage(1),
      partialSessionId: "partial-live",
      sourceKind: "workspace-manager",
      sourceLabel: "Noah · vynel",
    };
    const live = mount(ThreadStream, {
      props: {
        messages: [sent],
        toolCallsByMessageId: {},
        activeTurn: null,
        liveTraceIds: new Set(["partial-live"]),
      },
      global: { plugins: [createPinia()] },
    });
    expect(live.getComponent(MessageRow).props("linkedSessionLive")).toBe(true);

    const idle = mount(ThreadStream, {
      props: { messages: [sent], toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });
    expect(idle.getComponent(MessageRow).props("linkedSessionLive")).toBe(false);
  });

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

  it("never chips a report-DELIVERY turn's rows (session-comms): the attributed inbound report + the reply stay bare, a separate sent-down chip survives", () => {
    // A notify turn as it lands on the CREATOR's transcript (workspace primary
    // or the global root — same row shape either way): the report arrives as
    // role:'user' + sourceKind:'workspace-manager' + the DELIVERY job's trace
    // key, and the thread's own reply shares it. Chipping either would render
    // a Watch pointing at the thread's OWN turn, labeled with the report body
    // — the exact self-watch leak class 12b90bd killed. The widened
    // discriminator (ANY attributed user row) suppresses both; a sent-down
    // report on another trace keeps its chip on the same surface.
    const arrivingReport: ChatMessageResponse = {
      ...makeMessage(0),
      role: "user",
      sourceKind: "workspace-manager",
      sourceLabel: "Acme research",
      partialSessionId: "delivery-in",
    };
    const threadReply: ChatMessageResponse = {
      ...makeMessage(1),
      sourceKind: "workspace-manager",
      sourceLabel: "Sarah · letterman",
      partialSessionId: "delivery-in",
    };
    const sentDownReport: ChatMessageResponse = {
      ...makeMessage(3),
      sourceKind: "workspace-manager",
      sourceLabel: "Research helper",
      partialSessionId: "partial-out",
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [arrivingReport, threadReply, sentDownReport],
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

  it("groups consecutive assistant rows under ONE author line — a reloaded turn reads like the live overlay", () => {
    // One turn persists as several assistant rows (one per provider message).
    // Only the first of a run shows the header; a user row breaks the group.
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(0), role: "user" },
      { ...makeMessage(1), id: "a1", role: "assistant" },
      { ...makeMessage(2), id: "a2", role: "assistant" },
      { ...makeMessage(3), id: "a3", role: "assistant" },
      { ...makeMessage(4), role: "user" },
      { ...makeMessage(5), id: "a4", role: "assistant" },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const rows = wrapper.findAll(".message-row");
    const headerCounts = rows.map((row) => row.findAll(".row-header").length);
    // user · assistant(+header) · 2 continuations · user · assistant(+header)
    expect(headerCounts).toEqual([1, 1, 0, 0, 1, 1]);
    expect(rows[2]!.classes()).toContain("is-continuation");
  });

  it("does NOT group assistant rows separated by a long gap — two background turns keep their timestamps", () => {
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(1), id: "a1", role: "assistant" },
      {
        ...makeMessage(3),
        id: "a2",
        role: "assistant",
        createdAt: "2026-07-05T11:00:00.000Z", // 1h after the fixture's 10:00
      },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const rows = wrapper.findAll(".message-row");
    expect(rows.map((row) => row.findAll(".row-header").length)).toEqual([1, 1]);
  });

  it("does NOT group assistant rows from different authors (a workspace report after a brain reply)", () => {
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(1), id: "a1", role: "assistant" },
      {
        ...makeMessage(3),
        id: "a2",
        role: "assistant",
        sourceKind: "workspace-manager",
        sourceLabel: "Noah · vynel",
      },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const rows = wrapper.findAll(".message-row");
    expect(rows.map((row) => row.findAll(".row-header").length)).toEqual([1, 1]);
  });

  it("a persona report row wears its resolved monogram, not the Claude mark (B8)", () => {
    const messages: ChatMessageResponse[] = [
      {
        ...makeMessage(2),
        id: "r1",
        role: "user",
        sourceKind: "agent",
        sourceLabel: "Nova",
        body: "[Report from Nova — the result of work you delegated, relayed automatically by Vynel. This is NOT a message the user typed.]\n\nDone.",
      },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const row = wrapper.get(".message-row");
    expect(row.find(".monogram-text").exists()).toBe(true);
    expect(row.find(".author-avatar svg").exists()).toBe(false);
    // The resolver→row CONTRACT: the accent travels as the bare property
    // NAME (the row wraps it in `var()` itself — a full reference here once
    // double-wrapped into invalid CSS and silently untinted every persona
    // chip). Asserted on the prop: happy-dom drops color-mix() style values,
    // so the rendered attribute can't carry the check.
    expect(wrapper.getComponent(MessageRow).props("authorPersona")).toMatchObject(
      { accentVar: expect.stringMatching(/^--ws-\d+$/) },
    );
  });

  it("the live-card overflow line opens the Background roster (B7)", async () => {
    const cards = Array.from({ length: 5 }, (_, index) => ({
      key: `trace-${index}`,
      partialSessionId: `trace-${index}`,
      persona: {
        name: `Persona ${index}`,
        imageUrl: null,
        monogram: "P",
        accentVar: "--ws-1",
      },
      taskLabel: `task ${index}`,
      state: "working" as const,
      acked: false,
      narration: null,
      recentSteps: [],
      startedAt: null,
    }));
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [],
        toolCallsByMessageId: {},
        activeTurn: null,
        liveCards: cards,
      },
      global: { plugins: [createPinia()] },
    });

    // Four visible + the overflow BUTTON naming the rest.
    expect(wrapper.findAll('[data-testid="persona-live-card"]')).toHaveLength(4);
    const overflow = wrapper.get('[data-testid="live-cards-overflow"]');
    expect(overflow.text()).toContain("+1 more running");
    await overflow.trigger("click");
    expect(wrapper.emitted("openBackground")).toHaveLength(1);
  });
});
