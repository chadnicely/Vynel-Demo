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
  // Author labels are persona-first: the brain speaks as Claude, a workspace
  // persona by its own label — "Assistant · X" prefixes are gone.
  it("labels a delegated-in user message as coming from Claude", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", sourceKind: "global-root" }),
      },
    });

    // test: correct expectation — redesign Q1: an UNLABELED routed-task stamp
    // stays scope-silent "Claude" (was "From Claude"); the labeled branch
    // below carries the origin scope.
    expect(wrapper.find(".role-label").text()).toBe("Claude");
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

  // Session-comms delivery — a REGULAR participant message (Chad, 2026-08-09,
  // superseding the 2026-07-27 compact-box call): full markdown body inline,
  // author line + quiet badge as identity, no accent bar, no View door.
  // test: correct expectation — teaser/chip/accent pins recast to full-body.
  it("renders an inbound user-role report as a regular participant message: author, badge, full body", () => {
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
    // Sheds the "your message" bubble but wears NO special chrome.
    expect(row.classes()).toContain("is-report");
    expect(row.classes()).not.toContain("has-accent");
    // The FULL body renders inline as markdown — no teaser, no door.
    expect(wrapper.text()).toContain("Full detail follows below.");
    expect(wrapper.find(".report-teaser").exists()).toBe(false);
    expect(wrapper.find(".report-open-chip").exists()).toBe(false);
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

  it("a LABELED routed-task anchor row reads Claude · from its origin scope (redesign Q1)", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "global-root",
          sourceLabel: "Global",
          body: "Run July invoicing",
        }),
      },
    });

    expect(wrapper.find(".role-label").text()).toBe("Claude · from Global");
  });

  it("a mention landing in a colleague's thread reads as You · from its origin (redesign Case 3)", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "user",
          sourceLabel: "Global",
          body: "what's our invoice numbering rule?",
        }),
      },
    });

    expect(wrapper.find(".role-label").text()).toBe("You · from Global");
    // The user speaking is never report-styled.
    expect(wrapper.find(".message-row").classes()).not.toContain("is-report");
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

describe("MessageRow author avatar", () => {
  it("a plain assistant row wears the Claude mark by default and the custom image when given", () => {
    const marked = mount(MessageRow, { props: { message: makeMessage() } });
    expect(marked.find(".author-avatar svg").exists()).toBe(true);

    const custom = mount(MessageRow, {
      props: {
        message: makeMessage(),
        assistantIconUrl: "data:image/png;base64,AAAA",
      },
    });
    const img = custom.find(".author-avatar img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("data:image/png;base64,AAAA");
  });

  it("rows NOT authored by the surface assistant keep the Claude mark, and user rows get no glyph", () => {
    const globalRoot = mount(MessageRow, {
      props: {
        message: makeMessage({ sourceKind: "global-root" }),
        assistantIconUrl: "data:image/png;base64,AAAA",
      },
    });
    expect(globalRoot.find(".author-avatar img").exists()).toBe(false);
    expect(globalRoot.find(".author-avatar svg").exists()).toBe(true);

    const user = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", body: "hi" }),
        assistantIconUrl: "data:image/png;base64,AAAA",
      },
    });
    expect(user.find(".author-avatar").exists()).toBe(false);
  });

  // Persona-sessions B8: a persona-attributed row wears ITS persona — the
  // host-resolved image or monogram — instead of the blanket Claude mark.
  it("a persona row wears the host-resolved monogram (or image); without the prop the mark stays", () => {
    const reportMessage = makeMessage({
      role: "user",
      sourceKind: "agent",
      sourceLabel: "Nova",
      body: "[Report from Nova — the result of work you delegated, relayed automatically by Vynel. This is NOT a message the user typed.]\n\nDone.",
    });

    const monogram = mount(MessageRow, {
      props: {
        message: reportMessage,
        authorPersona: { imageUrl: null, monogram: "N", accentVar: "--ws-1" },
      },
    });
    expect(monogram.get(".monogram-text").text()).toBe("N");
    expect(monogram.find(".author-avatar svg").exists()).toBe(false);

    const withImage = mount(MessageRow, {
      props: {
        message: reportMessage,
        authorPersona: {
          imageUrl: "data:image/png;base64,BBBB",
          monogram: "N",
          accentVar: "--ws-1",
        },
      },
    });
    expect(withImage.get(".author-avatar img").attributes("src")).toBe(
      "data:image/png;base64,BBBB",
    );

    const withoutProp = mount(MessageRow, { props: { message: reportMessage } });
    expect(withoutProp.find(".author-avatar svg").exists()).toBe(true);
  });

  it("an assistant PERSONA reply wears the persona too — never the surface assistant's image", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          sourceKind: "workspace-manager",
          sourceLabel: "Noah · vynel",
        }),
        assistantIconUrl: "data:image/png;base64,AAAA",
        authorPersona: { imageUrl: null, monogram: "NV", accentVar: "--ws-2" },
      },
    });
    expect(wrapper.get(".monogram-text").text()).toBe("NV");
    expect(wrapper.find(".author-avatar img").exists()).toBe(false);
  });
});

// The badge split (persona-sessions B8 + the direct kind): an interim UPDATE
// must never read as the finished result, a direct message reads as a
// message — while every kind renders its FULL body as a regular participant
// message (Chad, 2026-08-09; the View door + teaser retired).
// test: correct expectation — the door/teaser pins recast to badge+body.
describe("MessageRow badge split (update / report / message)", () => {
  const updateBody =
    "[Update from Nova — an interim status on work you delegated, relayed automatically by Vynel. The task is STILL RUNNING; this is NOT its result and NOT a message the user typed.]\n\nReceived — will report when done.";

  it("an inbound UPDATE wears the Update badge; the spoken text renders in full, marker stripped", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "Nova",
          body: updateBody,
        }),
      },
    });
    expect(wrapper.find(".origin-badge").text()).toBe("Update");
    expect(wrapper.text()).toContain("Received — will report when done.");
    expect(wrapper.text()).not.toContain("[Update from Nova");
    expect(wrapper.find(".report-open-chip").exists()).toBe(false);
  });

  it("an inbound DIRECT message (kind direct_to_user) wears the Message badge, full text inline under its title", () => {
    const directBody =
      "[Message from James · Claw Launcher — addressed DIRECTLY to the user and shown to them in this conversation, relayed automatically by Vynel. Not a message the user typed; do not restate it.]\n\nOverview of the agency app\n\nNuxt 4 + Vue 3; seven Pinia stores.";
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "James · Claw Launcher",
          body: directBody,
        }),
      },
    });
    expect(wrapper.find(".origin-badge").text()).toBe("Message");
    expect(wrapper.text()).toContain("Overview of the agency app");
    expect(wrapper.text()).toContain("Nuxt 4 + Vue 3; seven Pinia stores.");
    expect(wrapper.text()).not.toContain("[Message from James");
  });

  it("a final report keeps the Report badge", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "workspace-manager",
          sourceLabel: "Noah · vynel",
          body: "[Report from Noah · vynel — the result of work you delegated, relayed automatically by Vynel. This is NOT a message the user typed.]\n\nDone — shipped.",
        }),
      },
    });
    expect(wrapper.find(".origin-badge").text()).toBe("Report");
    expect(wrapper.text()).toContain("Done — shipped.");
  });
});
