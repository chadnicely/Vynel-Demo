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
  // test: correct expectation (Arc 5b conversation cards) — an exchange (ask +
  // reply) folds to ONE strip, so a folded card renders only its header row.
  it("renders the newest exchange fully; a folded exchange renders one strip", () => {
    const wrapper = mountStream(3);

    // Cards: [m0 ask + m1 reply] folded (one strip) · [m2 ask] open.
    expect(wrapper.findAll(".message-row")).toHaveLength(2);
    expect(wrapper.find(".older-note").exists()).toBe(false);
  });

  // Folding (Chad, 2026-08-09, re-grouped by the Arc 5b card): the thread
  // folds every exchange to its strip except the latest; any card toggles.
  it("only the LATEST exchange is expanded by default; older ones fold to strips", () => {
    const wrapper = mountStream(3);
    const rows = wrapper.findAll(".message-row");
    // Folded rows: the strip (preview + read-more, no body). The latest: full body.
    expect(rows[0]!.find(".turn-preview").exists()).toBe(true);
    expect(rows[0]!.find(".read-more").exists()).toBe(true);
    expect(rows[0]!.find(".plain-body").exists()).toBe(false);
    expect(rows[1]!.find(".turn-preview").exists()).toBe(false);
    expect(rows[1]!.text()).toContain("message 2");
  });

  it("the header chevron toggles any exchange open and closed", async () => {
    const wrapper = mountStream(3);
    await wrapper
      .findAll(".message-row")[0]!
      .find(".collapse-toggle")
      .trigger("click");
    // Open: the ask's body AND the reply row render.
    expect(
      wrapper.findAll(".message-row")[0]!.find(".plain-body").exists(),
    ).toBe(true);
    expect(wrapper.findAll(".message-row")).toHaveLength(3);
    await wrapper
      .findAll(".message-row")[0]!
      .find(".collapse-toggle")
      .trigger("click");
    expect(
      wrapper.findAll(".message-row")[0]!.find(".plain-body").exists(),
    ).toBe(false);
    expect(wrapper.findAll(".message-row")).toHaveLength(2);
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
    // 100 windowed messages = 50 exchanges: 49 folded strips + the open
    // latest card's 2 rows (Arc 5b conversation cards).
    expect(rows).toHaveLength(51);
    // The newest message is the last row; the oldest 50 stay unrendered.
    expect(rows[rows.length - 1]!.text()).toContain("message 149");
    expect(rows[0]!.text()).toContain("message 50");
    expect(wrapper.find(".older-note").text()).toContain("50 earlier messages");
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
    // test: correct expectation (2026-08-15) — the pointer wears the canvas's
    // handed-off card, whose eyebrow is title-case and uppercased in CSS. Was
    // the lowercase literal "done".
    expect(pointer.text()).toContain("Done");
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
    const history = [
      makeMessage(0),
      makeMessage(1),
      makeMessage(2),
      makeMessage(3),
    ];
    const activeTurn: ActiveTurnView = {
      ...createActiveTurnView(),
      userMessage: history[2]!, // the turn's own user message, already persisted
      segments: [
        {
          messageId: "m3",
          text: "streaming reply…",
          thinking: "",
          toolCalls: [],
        },
      ],
    };
    const wrapper = mount(ThreadStream, {
      props: { messages: history, toolCallsByMessageId: {}, activeTurn },
      global: { plugins: [createPinia()] },
    });

    // Settled rows m0+m1 render from history; m2 (user) renders once via the
    // overlay; m3 renders only as the live turn.
    const rowTexts = wrapper.findAll(".message-row").map((row) => row.text());
    expect(rowTexts.filter((text) => text.includes("message 2"))).toHaveLength(
      1,
    );
    expect(rowTexts.some((text) => text.includes("message 3"))).toBe(false);
    expect(wrapper.text()).toContain("streaming reply…");
  });

  // The conversation cards (Arc 3 + 5b): ONE wrapper per exchange (ask +
  // reply together) — folded past cards dim, the latest reads open.
  it("wraps each exchange in a card — folded cards wear is-folded, the latest is-open", () => {
    const wrapper = mountStream(3);
    const cards = wrapper.findAll(".turn-card");
    // [m0 ask + m1 reply] · [m2 ask] — the reply shares the ask's card.
    expect(cards).toHaveLength(2);
    expect(cards[0]!.classes()).toContain("is-folded");
    expect(cards[1]!.classes()).toContain("is-open");
  });

  it("a streaming turn renders the live card with the ticking working pill", () => {
    const activeTurn: ActiveTurnView = {
      ...createActiveTurnView(),
      status: "streaming",
      startedAtMs: Date.now() - 95_000,
      segments: [
        { messageId: "live-1", text: "on it…", thinking: "", toolCalls: [] },
      ],
    };
    const wrapper = mount(ThreadStream, {
      props: {
        messages: [],
        toolCallsByMessageId: {},
        activeTurn,
        assistantName: "Ryan",
      },
      global: { plugins: [createPinia()] },
    });

    const liveCard = wrapper.find(".turn-card.is-live");
    expect(liveCard.exists()).toBe(true);
    expect(liveCard.find(".live-spine").exists()).toBe(true);
    const pill = liveCard.find(".working-pill");
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toContain("Ryan working");
    // 95s ago → "1m 35s" (formatElapsed's m/s shape; the mount tick is <1s).
    expect(pill.text()).toMatch(/1m 3[56]s/);
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

    // test: correct expectation (reply fold, 2026-08-15) — opening the CARD
    // now shows the ask plus the reply's SUMMARY row; the continuation run is
    // part of the real view and waits behind the reply caret. Was: one click
    // revealed all six rows.
    const folded = wrapper.findAll(".message-row");
    expect(folded.map((row) => row.findAll(".row-header").length)).toEqual([
      1, 1, 1,
    ]);
    await folded[0]!.find(".collapse-toggle").trigger("click");

    const summarised = wrapper.findAll(".message-row");
    expect(summarised).toHaveLength(4);
    await summarised[1]!.find(".reply-caret").trigger("click");

    const rows = wrapper.findAll(".message-row");
    const headerCounts = rows.map((row) => row.findAll(".row-header").length);
    // user · assistant(+header) · 2 continuations · user · assistant(+header)
    expect(headerCounts).toEqual([1, 1, 0, 0, 1, 1]);
    expect(rows[2]!.classes()).toContain("is-continuation");
    // The reply's first row wears the canvas's divider inside the card.
    expect(rows[1]!.classes()).toContain("is-reply-start");
  });

  // THE REPLY FOLD (Kafi, 2026-08-15): one rule for every chat — a settled
  // turn shows its summary line; opening it shows the turn AS IT RAN.
  function makeToolCall(parentMessageId: string): ChatToolCallResponse {
    return {
      id: `tc-${parentMessageId}`,
      parentMessageId,
      toolUseId: `tu-${parentMessageId}`,
      toolName: "Read",
      toolInput: { path: "CLAUDE.md" },
      toolOutput: "ok",
      status: "completed",
      approvalStatus: null,
      isErrorResult: false,
      delegation: null,
      startedAt: "2026-07-05T10:00:00.000Z",
      completedAt: "2026-07-05T10:00:01.000Z",
    };
  }

  // The agent-spawn pointer (2026-08-18): an Agent/Task call in the SETTLED
  // thread wears the same PointerRow a delegated task does — placed on the
  // carrying row, anchored on the call's toolUseId, its door the nested
  // activity pane. An ordinary tool call must never grow one.
  it("places an agent-spawn pointer on the carrying row, with the last act and the pane door", async () => {
    const agentCall: ChatToolCallResponse = {
      ...makeToolCall("a1"),
      id: "tc-agent",
      toolUseId: "toolu_agent",
      toolName: "Agent",
      toolInput: { description: "Whoami check", subagent_type: "Explore" },
      status: "cancelled",
      subagentToolCalls: [
        {
          toolUseId: "n1",
          toolName: "Bash",
          toolInput: { command: "ls -la apps/" },
          status: "started",
          startedAt: "2026-07-05T10:00:00.000Z",
          completedAt: null,
        },
      ],
    };
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(0), role: "user" },
      { ...makeMessage(1), id: "a1", role: "assistant", body: "Spawning." },
    ];
    const wrapper = mount(ThreadStream, {
      props: {
        messages,
        toolCallsByMessageId: { a1: [agentCall, makeToolCall("a1")] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    // One pointer — the Agent call's; the ordinary Read grows none.
    const pointers = wrapper.findAll('[data-testid="thread-pointer"]');
    expect(pointers).toHaveLength(1);
    const pointer = pointers[0]!;
    // A cancelled spawn settles failed, and its last act wears the line.
    expect(pointer.attributes("data-status")).toBe("failed");
    expect(pointer.text()).toContain("Whoami check");
    expect(pointer.text()).toContain("Explore");
    expect(pointer.text()).toContain("ls -la apps/");

    await pointer.trigger("click");
    const emitted = wrapper.emitted("openPointer");
    expect(emitted).toHaveLength(1);
    // The door: the nested pane keyed by the spawn inside its host session.
    expect(emitted![0]![0]).toMatchObject({
      agentRun: { hostSessionId: "s1", toolUseId: "toolu_agent" },
    });
  });

  it("a folded reply hides the tool calls AND the later rows; opening shows the turn as it ran", async () => {
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(0), role: "user" },
      {
        ...makeMessage(1),
        id: "a1",
        role: "assistant",
        body: "Summary line.\n\nDetail paragraph.",
      },
      { ...makeMessage(2), id: "a2", role: "assistant", body: "Later message." },
    ];
    const wrapper = mount(ThreadStream, {
      props: {
        messages,
        toolCallsByMessageId: { a1: [makeToolCall("a1")] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    // test: correct expectation (2026-08-15) — the NEWEST turn now opens with
    // its whole run. Was folded on arrival, which snapped an answer shut the
    // instant it settled.
    expect(wrapper.findAll(".message-row")).toHaveLength(3);
    expect(wrapper.find(".tool-list").exists()).toBe(true);
    expect(wrapper.text()).toContain("Detail paragraph.");
    expect(wrapper.text()).toContain("Later message.");

    await wrapper.get(".reply-caret").trigger("click");

    // Folded: the ask and ONE summary row. Nothing else — the tool card is
    // part of the real view, and gating the row alone would leave it on show.
    expect(wrapper.findAll(".message-row")).toHaveLength(2);
    expect(wrapper.find(".tool-list").exists()).toBe(false);
    expect(wrapper.text()).toContain("Summary line.");
    expect(wrapper.text()).not.toContain("Detail paragraph.");
    expect(wrapper.text()).not.toContain("Later message.");
  });

  it("the summary comes from the first row that SPEAKS — a tool-only opening row is skipped", async () => {
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(0), role: "user" },
      { ...makeMessage(1), id: "a1", role: "assistant", body: "" },
      { ...makeMessage(2), id: "a2", role: "assistant", body: "The real answer." },
    ];
    const wrapper = mount(ThreadStream, {
      props: {
        messages,
        toolCallsByMessageId: { a1: [makeToolCall("a1")] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    // The newest turn opens; fold it to see which row carries the summary.
    await wrapper.get(".reply-caret").trigger("click");

    const rows = wrapper.findAll(".message-row");
    expect(rows).toHaveLength(2);
    expect(rows[1]!.text()).toContain("The real answer.");
    // Promoted to the reply's start, so it wears the author line and the
    // hairline even though it is not the turn's first assistant row.
    expect(rows[1]!.findAll(".row-header")).toHaveLength(1);
    expect(rows[1]!.classes()).toContain("is-reply-start");
  });

  // History folds; what just happened does not. The canvas closes every reply,
  // but it has no streaming — here you watch the answer arrive, and folding it
  // the instant it settled shut the thing you were mid-sentence in.
  it("the NEWEST turn opens; older ones stay folded", async () => {
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(0), role: "user" },
      { ...makeMessage(1), id: "a1", role: "assistant", body: "Older.\n\nOlder detail." },
      { ...makeMessage(2), role: "user" },
      { ...makeMessage(3), id: "a2", role: "assistant", body: "Newest.\n\nNewest detail." },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.text()).toContain("Newest detail.");

    // The older exchange is card-folded to its strip, so nothing of its reply
    // shows; opening the CARD still leaves the reply summarised.
    expect(wrapper.text()).not.toContain("Older detail.");
    await wrapper.findAll(".collapse-toggle")[0]!.trigger("click");
    expect(wrapper.text()).toContain("Older.");
    expect(wrapper.text()).not.toContain("Older detail.");
  });

  it("a tool-opening turn keeps its caret once expanded — the fold is never one-way", async () => {
    // Folded, the SPEAKING row is promoted and draws the author line. Open,
    // the tool-only row heads the reply and the speaker trails as a headerless
    // continuation — so the caret has to follow the header, not the speaker,
    // or an expanded turn can never be closed again.
    const messages: ChatMessageResponse[] = [
      { ...makeMessage(0), role: "user" },
      { ...makeMessage(1), id: "a1", role: "assistant", body: "" },
      { ...makeMessage(2), id: "a2", role: "assistant", body: "Created the task." },
    ];
    const wrapper = mount(ThreadStream, {
      props: {
        messages,
        toolCallsByMessageId: { a1: [makeToolCall("a1")] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });

    // Open (the newest turn): the tool-only row heads the reply, so the caret
    // has to be on THAT row or the turn could never be closed again.
    expect(wrapper.find(".tool-list").exists()).toBe(true);
    expect(wrapper.findAll(".reply-caret")).toHaveLength(1);

    await wrapper.get(".reply-caret").trigger("click");
    expect(wrapper.find(".tool-list").exists()).toBe(false);
    expect(wrapper.findAll(".message-row")).toHaveLength(2);

    // And back open — folded, the promoted speaking row carries it.
    expect(wrapper.findAll(".reply-caret")).toHaveLength(1);
    await wrapper.get(".reply-caret").trigger("click");
    expect(wrapper.find(".tool-list").exists()).toBe(true);
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
    expect(rows.map((row) => row.findAll(".row-header").length)).toEqual([
      1, 1,
    ]);
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
    expect(rows.map((row) => row.findAll(".row-header").length)).toEqual([
      1, 1,
    ]);
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
    expect(
      wrapper.getComponent(MessageRow).props("authorPersona"),
    ).toMatchObject({ accentVar: expect.stringMatching(/^--ws-\d+$/) });
  });

  // 2026-08-09 parity pass: the workspace chat renders exactly like Global —
  // a persona's OWN reply rows wear the same author treatment as its
  // delivered rows (persona name + workspace chip), and the persona monogram
  // comes from the label's persona part, never the separator dot.
  it("an assistant persona row wears the workspace chip and drops the label's workspace text", () => {
    const messages: ChatMessageResponse[] = [
      {
        ...makeMessage(1),
        id: "a1",
        role: "assistant",
        sourceKind: "workspace-manager",
        sourceLabel: "James · Claw Launcher",
        body: "All three modules are green.",
      },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const row = wrapper.get(".message-row");
    expect(row.find(".workspace-badge").exists()).toBe(true);
    expect(row.get(".role-label").text()).toContain("James");
    expect(row.get(".role-label").text()).not.toContain("Claw Launcher");
    // The avatar monograms from the PERSONA part ("JA"), never "J·".
    expect(row.get(".monogram-text").text()).toBe("JA");
  });

  it("a folded turn opening with tool calls previews the turn's first text — or its first tool", () => {
    const readCall: ChatToolCallResponse = {
      id: "tc-read",
      parentMessageId: "a1",
      toolUseId: "tu-read",
      toolName: "Read",
      toolInput: { file_path: "CLAUDE.md" },
      toolOutput: "…",
      status: "completed",
      approvalStatus: null,
      isErrorResult: false,
      startedAt: "2026-07-05T10:00:00.000Z",
      completedAt: "2026-07-05T10:00:01.000Z",
    };
    // Turn 1: a body-less header row + a continuation carrying the text.
    const withText: ChatMessageResponse[] = [
      { ...makeMessage(1), id: "a1", role: "assistant", body: "" },
      {
        ...makeMessage(1),
        id: "a2",
        role: "assistant",
        body: "The answer line.\nMore.",
      },
      { ...makeMessage(2), id: "u1", role: "user", body: "next" },
    ];
    const textWrapper = mount(ThreadStream, {
      props: {
        messages: withText,
        toolCallsByMessageId: { a1: [readCall] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });
    expect(textWrapper.get(".turn-preview").text()).toBe("The answer line.");

    // A turn with NO text anywhere falls to its first tool call's summary.
    const toolOnly: ChatMessageResponse[] = [
      { ...makeMessage(1), id: "a1", role: "assistant", body: "" },
      { ...makeMessage(2), id: "u1", role: "user", body: "next" },
    ];
    const toolWrapper = mount(ThreadStream, {
      props: {
        messages: toolOnly,
        toolCallsByMessageId: { a1: [readCall] },
        activeTurn: null,
      },
      global: { plugins: [createPinia()] },
    });
    expect(toolWrapper.get(".turn-preview").text()).toBe("Read CLAUDE.md");
  });

  // The origin chip (Chad, 2026-08-09): a relayed anchor's "from X" text
  // becomes a chip — Global wears the house glyph; the profile card rides
  // the same hover as the workspace chip. Works on every ThreadStream host.
  it("a CLAUDE · FROM GLOBAL anchor row wears the global chip and drops the from-text", () => {
    const messages: ChatMessageResponse[] = [
      {
        ...makeMessage(0),
        id: "t1",
        role: "user",
        sourceKind: "global-root",
        sourceLabel: "Global",
        body: "@James how many modules in the backend?",
      },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const row = wrapper.get(".message-row");
    expect(row.get(".workspace-badge").classes()).toContain("is-global");
    expect(row.get(".role-label").text()).toContain("Claude");
    expect(row.get(".role-label").text()).not.toContain("from Global");
  });

  // Per-turn run stats (Chad, 2026-08-09): every assistant turn wears the
  // info door. A row's inputTokens is the request's WHOLE context occupancy
  // (summing was the 462.8k bug; showing it raw read as "the session total"
  // — Chad's follow-up), so the turn's "in" is its occupancy GROWTH over the
  // previous turn, and the occupancy itself rides as Context.
  it("a turn's stats show its context GROWTH as in, summed output, and the occupancy", () => {
    const messages: ChatMessageResponse[] = [
      {
        ...makeMessage(1),
        id: "a1",
        role: "assistant",
        inputTokens: 40_000,
        outputTokens: 120,
        startedAt: "2026-07-05T10:00:00.000Z",
        completedAt: "2026-07-05T10:00:04.000Z",
      },
      {
        ...makeMessage(1),
        id: "a2",
        role: "assistant",
        inputTokens: 41_500,
        outputTokens: 80,
        startedAt: "2026-07-05T10:00:04.000Z",
        completedAt: "2026-07-05T10:00:09.000Z",
      },
      { ...makeMessage(2), id: "u1", role: "user", body: "next ask" },
      {
        ...makeMessage(3),
        id: "a3",
        role: "assistant",
        inputTokens: 43_000,
        outputTokens: 60,
        startedAt: "2026-07-05T10:01:00.000Z",
        completedAt: "2026-07-05T10:01:02.000Z",
      },
    ];
    const wrapper = mount(ThreadStream, {
      props: {
        messages,
        toolCallsByMessageId: {},
        activeTurn: null,
        sessionModel: "claude-fable-5",
      },
      global: { plugins: [createPinia()] },
    });

    const rows = wrapper.findAllComponents(MessageRow);
    // Turn 1 opened the thread: its growth IS its occupancy.
    expect(rows[0]!.props("runStats")).toEqual({
      model: "claude-fable-5",
      toolCallCount: 0,
      inputTokens: 41_500,
      outputTokens: 200,
      contextTokens: 41_500,
      durationMs: 9000,
    });
    // Turn 2 grew the 41.5k context to 43k: +1.5k in.
    expect(rows.at(-1)!.props("runStats")).toEqual({
      model: "claude-fable-5",
      toolCallCount: 0,
      inputTokens: 1500,
      outputTokens: 60,
      contextTokens: 43_000,
      durationMs: 2000,
    });
    expect(wrapper.find(".run-info").exists()).toBe(true);
  });

  it("a turn whose occupancy SHRANK (compaction) reports no fresh-in — context still served", () => {
    const messages: ChatMessageResponse[] = [
      {
        ...makeMessage(1),
        id: "a1",
        role: "assistant",
        inputTokens: 40_000,
        outputTokens: 100,
      },
      { ...makeMessage(2), id: "u1", role: "user", body: "keep going" },
      {
        ...makeMessage(3),
        id: "a2",
        role: "assistant",
        inputTokens: 8000,
        outputTokens: 50,
      },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });

    const lastTurn = wrapper.findAllComponents(MessageRow).at(-1)!;
    expect(lastTurn.props("runStats")).toMatchObject({
      inputTokens: null,
      contextTokens: 8000,
    });
  });

  it("a marker-only delivered row never leaks the model-facing marker into its strip", () => {
    // The reviewer-caught edge: content-less report → own displayBody empty →
    // the fallback fires, and it must read the STRIPPED body, not the raw one.
    const messages: ChatMessageResponse[] = [
      {
        ...makeMessage(0),
        id: "r1",
        role: "user",
        sourceKind: "agent",
        sourceLabel: "Nova",
        body: "[Report from Nova — the result of work you delegated, relayed automatically by Vynel. This is NOT a message the user typed.]\n\n",
      },
      { ...makeMessage(2), id: "u1", role: "user", body: "next" },
    ];
    const wrapper = mount(ThreadStream, {
      props: { messages, toolCallsByMessageId: {}, activeTurn: null },
      global: { plugins: [createPinia()] },
    });
    // The strip renders bare (author + time) — never the raw marker line.
    const strip = wrapper.findAll(".message-row")[0]!;
    expect(strip.text()).not.toContain("[Report from");
  });
});
