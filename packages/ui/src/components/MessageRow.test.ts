import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import MessageRow from "./MessageRow.vue";

function makeMessage(
  overrides: Partial<ChatMessageResponse> = {},
): ChatMessageResponse {
  return {
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    body: "Handed off.",
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: "2026-07-05T10:00:00.000Z",
    completedAt: "2026-07-05T10:00:01.000Z",
    createdAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("MessageRow", () => {
  it("shows a watch-live chip when the message links a session, and emits on click", async () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          partialSessionId: "child-session",
          sourceLabel: "Marketing site · Mara",
        }),
      },
    });

    const chip = wrapper.find(".session-link");
    expect(chip.text()).toContain("Watch Marketing site · Mara");

    await chip.trigger("click");
    expect(wrapper.emitted("openSession")).toEqual([["child-session"]]);
  });

  it("renders no chip for ordinary messages", () => {
    const wrapper = mount(MessageRow, { props: { message: makeMessage() } });

    expect(wrapper.find(".session-link").exists()).toBe(false);
  });

  it("suppresses the chip when showWatchChip is false (the workspace's own transcript)", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({ partialSessionId: "child-session" }),
        showWatchChip: false,
      },
    });

    expect(wrapper.find(".session-link").exists()).toBe(false);
  });

  it("labels a delegated-in user message as coming from Global", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", sourceKind: "global-root" }),
      },
    });

    expect(wrapper.find(".role-label").text()).toBe("From Global");
  });
});
