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

  it("wears a workspace accent bar on a bubbled-up report", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          sourceKind: "workspace-manager",
          sourceLabel: "Noah · vynel",
        }),
      },
    });

    const row = wrapper.find(".message-row");
    expect(row.classes()).toContain("has-accent");
    expect(row.attributes("style")).toContain("--accent");
  });

  it("suppresses the accent inside the workspace's own room (showWatchChip false)", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          sourceKind: "workspace-manager",
          sourceLabel: "Noah · vynel",
        }),
        showWatchChip: false,
      },
    });

    expect(wrapper.find(".message-row").classes()).not.toContain("has-accent");
  });

  it("stays neutral for the global brain and the user (no accent)", () => {
    const brain = mount(MessageRow, {
      props: { message: makeMessage({ sourceKind: "global-root" }) },
    });
    expect(brain.find(".message-row").classes()).not.toContain("has-accent");

    const user = mount(MessageRow, {
      props: { message: makeMessage({ role: "user" }) },
    });
    expect(user.find(".message-row").classes()).not.toContain("has-accent");
  });
});
