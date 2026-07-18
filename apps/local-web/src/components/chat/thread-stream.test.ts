import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
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

  it("hides persisted rows the live overlay already renders (mid-turn refetch dedupe)", () => {
    // Rows persist per chunk, so a refetch during a turn returns the very
    // messages the overlay is streaming — they must not double-render.
    const history = [makeMessage(0), makeMessage(1), makeMessage(2), makeMessage(3)];
    const activeTurn: ActiveTurnView = {
      ...createActiveTurnView(),
      userMessage: history[2]!, // the turn's own user message, already persisted
      assistantMessageId: "m3",
      assistantMessageIds: ["m3"],
      text: "streaming reply…",
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
