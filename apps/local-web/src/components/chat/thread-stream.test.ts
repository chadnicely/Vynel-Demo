import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
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

  // TURN folding (Chad, 2026-08-09): the thread folds every turn to its strip
  // except the latest; any turn toggles freely.
  it("only the LATEST turn is expanded by default; older turns fold to strips", () => {
    const wrapper = mountStream(3);
    const rows = wrapper.findAll(".message-row");
    // Folded rows: the strip (preview, no body). The latest: full body.
    expect(rows[0]!.find(".turn-preview").exists()).toBe(true);
    expect(rows[0]!.find(".plain-body").exists()).toBe(false);
    expect(rows[2]!.find(".turn-preview").exists()).toBe(false);
    expect(rows[2]!.text()).toContain("message 2");
  });

  it("the header chevron toggles any turn open and closed", async () => {
    const wrapper = mountStream(3);
    await wrapper.findAll(".message-row")[0]!.find(".collapse-toggle").trigger("click");
    expect(wrapper.findAll(".message-row")[0]!.find(".plain-body").exists()).toBe(true);
    await wrapper.findAll(".message-row")[0]!.find(".collapse-toggle").trigger("click");
    expect(wrapper.findAll(".message-row")[0]!.find(".plain-body").exists()).toBe(false);
  });

  it("landing on an anchor inside a folded turn unfolds it first", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const messages = Array.from({ length: 12 }, (_, i) => makeMessage(i));
    messages[5] = { ...makeMessage(5), partialSessionId: "trace-fold" };
    const wrapper = mount(ThreadStream, {
      props: {
        messages,
        toolCallsByMessageId: {},
        activeTurn: null,
        scrollToTraceId: "trace-fold",
      },
      global: { plugins: [createPinia()] },
    });
    await nextTick();
    await nextTick();
    const row = wrapper.find('[data-trace-id="trace-fold"]');
    expect(row.exists()).toBe(true);
    expect(row.classes()).toContain("pointer-anchor-flash");
    // The turn unfolded: the strip's preview is gone, the body renders.
    expect(row.find(".turn-preview").exists()).toBe(false);
    expect(row.text()).toContain("message 5");
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
  // pointer under the hand-off row — once per trace, sender-side only. It
  // PERSISTS (Chad, 2026-08-09): live state rides the poll map; a settled
  // task keeps its pointer from the tool call's served delegation payload. ──

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
        workspaceId: null,
        targetSessionId: null,
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

  it("a SETTLED task keeps its pointer — built from the served delegation payload, done state, still clickable", async () => {
    const handOff = makeMessage(1);
    const dispatchCall: ChatToolCallResponse = {
      id: "tc-settled",
      parentMessageId: handOff.id,
      toolUseId: "tu-settled",
      toolName: "send_message",
      toolInput: { to: "workspace:letterman" },
      toolOutput: "queued",
      status: "completed",
      approvalStatus: null,
      isErrorResult: false,
      delegation: {
        jobId: "job-2",
        partialSessionId: "trace-5",
        status: "completed",
        deliveredTo: "letterman",
        taskLabel: "Overview of access levels",
        reportedAt: "2026-08-09T10:05:00.000Z",
        completedAt: "2026-08-09T10:05:01.000Z",
        workspaceId: "ws-letterman",
        targetSessionId: null,
      },
      startedAt: "2026-08-09T10:00:00.000Z",
      completedAt: "2026-08-09T10:00:01.000Z",
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [handOff],
        toolCallsByMessageId: { [handOff.id]: [dispatchCall] },
        activeTurn: null,
        // The in-flight poll no longer carries the settled job — the pointer
        // must come from the payload alone (the persistence mechanic).
        pointersByTraceId: new Map(),
      },
      global: { plugins: [createPinia()] },
    });

    const pointer = wrapper.find('[data-testid="thread-pointer"]');
    expect(pointer.exists()).toBe(true);
    expect(pointer.attributes("data-status")).toBe("completed");
    expect(pointer.text()).toContain("Overview of access levels");
    expect(pointer.text()).toContain("letterman");
    expect(pointer.text()).toContain("done");
    await pointer.trigger("click");
    expect(wrapper.emitted("openPointer")).toEqual([
      [
        {
          partialSessionId: "trace-5",
          taskLabel: "Overview of access levels",
          targetLabel: "letterman",
          status: "completed",
          targetSessionId: null,
          workspaceId: "ws-letterman",
        },
      ],
    ]);
  });

  it("a scroll-to anchor reveals + lands on the trace row and flashes it (the pointer's landing)", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    // 150 rows with the anchor DEEP in the hidden-older window — the landing
    // must reveal the full history, then land (the reveal-then-land loop).
    const messages = Array.from({ length: 150 }, (_, i) => makeMessage(i));
    messages[5] = { ...makeMessage(5), partialSessionId: "trace-9" };
    const wrapper = mount(ThreadStream, {
      props: {
        messages,
        toolCallsByMessageId: {},
        activeTurn: null,
        scrollToTraceId: "trace-9",
      },
      global: { plugins: [createPinia()] },
    });
    for (let i = 0; i < 4; i += 1) await nextTick();

    const row = wrapper.find('[data-trace-id="trace-9"]');
    expect(row.exists()).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(row.classes()).toContain("pointer-anchor-flash");
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

  it("groups consecutive assistant rows under ONE author line — a reloaded turn reads like the live overlay", async () => {
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

    // test: correct expectation (turn folding) — a folded turn renders only
    // its header strip, so the continuations appear once the turn is opened.
    const folded = wrapper.findAll(".message-row");
    expect(folded.map((row) => row.findAll(".row-header").length)).toEqual([1, 1, 1, 1]);
    await folded[1]!.find(".collapse-toggle").trigger("click");

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
});
