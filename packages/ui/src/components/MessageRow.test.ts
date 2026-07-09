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

  // Author labels are persona-first: the brain speaks as Claude, a workspace
  // persona by its own label — "Assistant · X" prefixes are gone.
  it("labels a delegated-in user message as coming from Claude", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", sourceKind: "global-root" }),
      },
    });

    expect(wrapper.find(".role-label").text()).toBe("From Claude");
  });

  it("names the global brain Claude and a workspace report by its persona", () => {
    const brain = mount(MessageRow, {
      props: { message: makeMessage({ sourceKind: "global-root" }) },
    });
    expect(brain.find(".role-label").text()).toBe("Claude");

    const report = mount(MessageRow, {
      props: {
        message: makeMessage({
          sourceKind: "workspace-manager",
          sourceLabel: "Noah · vynel",
        }),
      },
    });
    expect(report.find(".role-label").text()).toBe("Noah · vynel");
  });

  it("names a plain assistant row (no sourceKind) after the surface's assistant", () => {
    const unnamed = mount(MessageRow, { props: { message: makeMessage() } });
    expect(unnamed.find(".role-label").text()).toBe("Assistant");

    const named = mount(MessageRow, {
      props: { message: makeMessage(), assistantName: "Claude" },
    });
    expect(named.find(".role-label").text()).toBe("Claude");
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
