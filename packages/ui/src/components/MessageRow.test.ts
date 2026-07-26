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
          // Persona-FIRST ("<manager> · <workspace>") — the one real form; a
          // workspace-first fixture here once defended the inverted parse.
          sourceLabel: "Mara · Marketing site",
        }),
      },
    });

    const chip = wrapper.find(".session-link");
    expect(chip.text()).toContain("Watch Mara · Marketing site");
    await chip.trigger("click");
    expect(wrapper.emitted("openSession")).toBeTruthy();
  });

  it("names the actual work when the row carries the delegated task label", async () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          partialSessionId: "child-session",
          // Persona-FIRST label — the workspace is the LAST segment.
          sourceLabel: "Noah · vynel",
          delegationTaskLabel: "Set up the login page",
        }),
      },
    });

    const chip = wrapper.find(".session-link");
    expect(chip.text()).toContain("vynel · Set up the login page");
    expect(chip.text()).not.toContain("Noah");

    await chip.trigger("click");
    expect(wrapper.emitted("openSession")).toEqual([["child-session"]]);
  });

  it("renders no chip for ordinary messages", () => {
    const wrapper = mount(MessageRow, { props: { message: makeMessage() } });

    expect(wrapper.find(".session-link").exists()).toBe(false);
  });

  // Pipeline scoping (Chad, 2026-07-21 evening): the host gates the chip per
  // ROW — a row of a delegation that targeted the host's own thread is the
  // parent's watch, so ThreadStream passes false. The row's identity (accent,
  // author) is untouched by the gate; only the chip goes.
  it("hides the watch chip when the host gates it — accent and author survive", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          partialSessionId: "child-session",
          sourceKind: "workspace-manager",
          sourceLabel: "Sarah · letterman",
        }),
        showWatchChip: false,
      },
    });

    expect(wrapper.find(".session-link").exists()).toBe(false);
    expect(wrapper.find(".message-row").classes()).toContain("has-accent");
    expect(wrapper.find(".role-label").text()).toBe("Sarah · letterman");
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

  it("badges a user message with the channel it arrived through", () => {
    const voiced = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", originChannel: "voice" }),
      },
    });
    expect(voiced.find(".origin-badge").text()).toBe("via Voice");

    const typed = mount(MessageRow, {
      props: { message: makeMessage({ role: "user" }) },
    });
    expect(typed.find(".origin-badge").exists()).toBe(false);

    // Origin marks how the USER's message arrived — assistant rows never wear it.
    const assistant = mount(MessageRow, {
      props: { message: makeMessage({ originChannel: "voice" }) },
    });
    expect(assistant.find(".origin-badge").exists()).toBe(false);
  });

  it("names a plain assistant row (no sourceKind) after the surface's assistant", () => {
    const unnamed = mount(MessageRow, { props: { message: makeMessage() } });
    expect(unnamed.find(".role-label").text()).toBe("Assistant");

    const named = mount(MessageRow, {
      props: { message: makeMessage(), assistantName: "Claude" },
    });
    expect(named.find(".role-label").text()).toBe("Claude");
  });

  // Session-comms delivery — the COMPACT incoming box (pipeline model, Chad
  // locked 2026-07-27): author identity + teaser + the View-report door, never
  // the full body inline. test: recast — an earlier spec rendered the full
  // markdown body in-thread; superseded by the compact-box call.
  it("renders an inbound user-role report as a compact box: author, teaser, View report", async () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "workspace-manager",
          sourceLabel: "Noah · vynel",
          body: "**Done.** The three files are indexed.\n\nFull detail follows below.",
        }),
      },
    });

    expect(wrapper.find(".role-label").text()).toContain("Noah · vynel");
    expect(wrapper.find(".role-label").text()).not.toContain("You");
    expect(wrapper.find(".origin-badge").text()).toBe("Report");
    const row = wrapper.find(".message-row");
    expect(row.classes()).toContain("is-report");
    expect(row.classes()).toContain("has-accent");
    // Compact: the teaser line, not the full body — no inline markdown render.
    expect(wrapper.find(".report-teaser").text()).toContain(
      "Done. The three files are indexed.",
    );
    expect(wrapper.text()).not.toContain("Full detail follows below.");
    // The door carries the FULL (marker-stripped) body to the review dialog.
    await wrapper.find(".report-open-chip").trigger("click");
    expect(wrapper.emitted("openReport")).toEqual([
      [
        {
          sourceLabel: "Noah · vynel",
          body: "**Done.** The three files are indexed.\n\nFull detail follows below.",
        },
      ],
    ]);
  });

  it("strips the model-facing attribution marker from a report's displayed body", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "workspace-manager",
          sourceLabel: "Sarah · letterman",
          body:
            "[Report from Sarah · letterman — the result of work you delegated, " +
            "relayed automatically by Vynel. This is NOT a message the user typed.]\n\n" +
            "The architecture doc is ready.",
        }),
      },
    });

    // The card's author line already names the reporter — the marker is for
    // the MODEL and never renders.
    expect(wrapper.text()).toContain("The architecture doc is ready.");
    expect(wrapper.text()).not.toContain("NOT a message the user typed");
  });

  it("keeps a plain user message as You — no report treatment without a source", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", body: "**not markdown**" }),
      },
    });

    expect(wrapper.find(".role-label").text()).toBe("You");
    expect(wrapper.find(".message-row").classes()).not.toContain("is-report");
    // The user's own text stays literal.
    expect(wrapper.find(".plain-body").exists()).toBe(true);
    expect(wrapper.html()).not.toContain("<strong>");
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
