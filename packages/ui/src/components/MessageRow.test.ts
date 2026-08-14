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

  // Session-comms delivery — a REPORT renders as a tool-card-style
  // collapsible (Chad, 2026-08-09 mock, superseding the same-day full-body
  // spec): report icon + the lead line as title, chevron at the line's end,
  // the body expanding in place. No header badge (the icon carries the kind),
  // no accent bar. test: correct expectation — recast to the card.
  it("renders an inbound report as a collapsed card: author, icon + title, body behind the chevron", async () => {
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
    expect(wrapper.find(".origin-badge").exists()).toBe(false);
    const row = wrapper.find(".message-row");
    // Sheds the "your message" bubble but wears NO special chrome.
    expect(row.classes()).toContain("is-report");
    expect(row.classes()).not.toContain("has-accent");
    // A SMALL remainder renders whole on the title line — no pointless
    // chevron on a short message (the fold floor).
    const card = wrapper.get(".inbound-card");
    expect(wrapper.find(".inbound-card-icon").exists()).toBe(true);
    expect(card.attributes("data-kind")).toBe("report");
    expect(card.text()).toContain("Done. The three files are indexed.");
    expect(card.text()).toContain("Full detail follows below.");
    expect(wrapper.find(".expand-chevron").exists()).toBe(false);
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

  // test: correct expectation — the workspace accent bar is retired
  // (2026-08-09 parity pass): a persona's own assistant rows are regular
  // participant messages, exactly like its delivered rows in Global. The
  // author line + workspace chip carry identity; no row wears accent chrome.
  it("no row wears accent chrome — persona, brain, or user", () => {
    for (const message of [
      makeMessage({
        sourceKind: "workspace-manager",
        sourceLabel: "Noah · vynel",
      }),
      makeMessage({ sourceKind: "global-root" }),
      makeMessage({ role: "user" }),
    ]) {
      const wrapper = mount(MessageRow, { props: { message } });
      expect(wrapper.find(".message-row").classes()).not.toContain(
        "has-accent",
      );
      expect(wrapper.find(".message-row").attributes("style")).toBeUndefined();
    }
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

  it("rows NOT authored by the surface assistant keep the Claude mark; a user row wears the person icon", () => {
    const globalRoot = mount(MessageRow, {
      props: {
        message: makeMessage({ sourceKind: "global-root" }),
        assistantIconUrl: "data:image/png;base64,AAAA",
      },
    });
    expect(globalRoot.find(".author-avatar img").exists()).toBe(false);
    expect(globalRoot.find(".author-avatar svg").exists()).toBe(true);

    // SPEC CHANGE (2026-08-15): the canvas puts the author's photo here, so
    // the slot is filled with a person glyph rather than left empty. Was
    // "user rows get no glyph".
    const user = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", body: "hi" }),
        assistantIconUrl: "data:image/png;base64,AAAA",
      },
    });
    expect(user.find(".author-avatar").exists()).toBe(true);
    // A glyph, never the assistant's photo — the user is not the assistant.
    expect(user.find(".author-avatar img").exists()).toBe(false);
    expect(user.find(".author-avatar svg").exists()).toBe(true);
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

    const withoutProp = mount(MessageRow, {
      props: { message: reportMessage },
    });
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

  // test: correct expectation — the kind badges retired for the card icons
  // (Chad: "same to message and update").
  it("an inbound UPDATE cards with the clock icon, no badge; the spoken text renders, marker stripped", () => {
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
    expect(wrapper.find(".origin-badge").exists()).toBe(false);
    expect(wrapper.get(".inbound-card").attributes("data-kind")).toBe("update");
    expect(wrapper.find(".inbound-card-icon").exists()).toBe(true);
    expect(wrapper.text()).toContain("Received — will report when done.");
    expect(wrapper.text()).not.toContain("[Update from Nova");
  });

  it("an inbound DIRECT message cards as kind message — short body whole on the title line", () => {
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
    expect(wrapper.find(".origin-badge").exists()).toBe(false);
    expect(wrapper.get(".inbound-card").attributes("data-kind")).toBe(
      "message",
    );
    expect(wrapper.text()).toContain("Overview of the agency app");
    expect(wrapper.text()).toContain("Nuxt 4 + Vue 3; seven Pinia stores.");
    expect(wrapper.text()).not.toContain("[Message from James");
  });

  // test: correct expectation — the report badge retired for the card icon.
  it("a final report wears NO badge — the card icon carries the kind; a one-liner gets no chevron", () => {
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
    expect(wrapper.find(".origin-badge").exists()).toBe(false);
    expect(wrapper.find(".inbound-card-icon").exists()).toBe(true);
    expect(wrapper.get(".inbound-card").attributes("data-kind")).toBe("report");
    expect(wrapper.text()).toContain("Done — shipped.");
    expect(wrapper.find(".expand-chevron").exists()).toBe(false);
  });
});

// The delivered-message CARD (Chad, 2026-08-09 — reports first, then "same to
// message and update"): every kind collapses card-style when its body is
// substantial; the chevron toggles the body in place — never a popup.
describe("MessageRow delivered-message card", () => {
  const lead =
    "Channels in Claw Launcher: only ONE external channel is wired up.";
  const detail =
    "Details:\n\n- Telegram is the only messaging channel the platform supports today, " +
    "with per-agent bots in the multi-agent setup and pairing-code approval flows.\n" +
    "- Web chat rides the dashboard's chat page — the OpenClaw web interface.\n" +
    "- The runtime supports more channels but the plugin allowlist does not expose them.";

  it("a report card collapses to icon + title; the chevron toggles the body in place", async () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "James · Claw Launcher",
          body: `[Report from James · Claw Launcher — the result of work you delegated, relayed automatically by Vynel. This is NOT a message the user typed.]\n\n${lead}\n\n${detail}`,
        }),
      },
    });

    expect(wrapper.get(".inbound-card-title").text()).toContain(lead);
    expect(wrapper.find(".expand-chevron").exists()).toBe(true);
    expect(wrapper.text()).not.toContain(
      "Telegram is the only messaging channel",
    );

    await wrapper.get(".inbound-card").trigger("click");
    expect(wrapper.text()).toContain("Telegram is the only messaging channel");
    expect(wrapper.find(".inbound-card-body").exists()).toBe(true);

    await wrapper.get(".inbound-card").trigger("click");
    expect(wrapper.text()).not.toContain(
      "Telegram is the only messaging channel",
    );
  });

  it("a long DIRECT message folds the same way, carded as kind message", async () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "James · Claw Launcher",
          body: `[Message from James · Claw Launcher — addressed DIRECTLY to the user and shown to them in this conversation, relayed automatically by Vynel. Not a message the user typed; do not restate it.]\n\n${lead}\n\n${detail}`,
        }),
      },
    });

    const card = wrapper.get(".inbound-card");
    expect(card.attributes("data-kind")).toBe("message");
    expect(card.text()).toContain(lead);
    expect(wrapper.text()).not.toContain(
      "Telegram is the only messaging channel",
    );
    await card.trigger("click");
    expect(wrapper.text()).toContain("Telegram is the only messaging channel");
  });

  it("a short update renders whole on the title line with NO chevron", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "Nova",
          body: "[Update from Nova — an interim status on work you delegated, relayed automatically by Vynel. The task is STILL RUNNING; this is NOT its result and NOT a message the user typed.]\n\nReceived.\n\nStarting on the schema now.",
        }),
      },
    });
    expect(wrapper.text()).toContain("Starting on the schema now.");
    expect(wrapper.find(".expand-chevron").exists()).toBe(false);
  });
});

// The workspace chip + run-stats door (Chad, 2026-08-09): the label's
// workspace segment becomes an icon (hover = profile card), and a served
// runStats grows the info icon (hover = model/tools/tokens/duration).
describe("MessageRow workspace chip + run stats", () => {
  const badge = {
    name: "Claw Launcher",
    imageUrl: null,
    monogram: "CL",
    accentVar: "--ws-2",
  };

  it("the chip replaces the label's workspace segment — persona name + monogram chip", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "James · Claw Launcher",
          body: "hi",
        }),
        workspaceBadge: badge,
      },
    });
    const label = wrapper.find(".role-label");
    expect(label.text()).toContain("James");
    expect(label.text()).not.toContain("Claw Launcher");
    expect(wrapper.get(".workspace-badge .badge-monogram").text()).toBe("CL");
  });

  // 2026-08-09 parity pass: a persona's OWN assistant rows split the same way
  // — in its workspace the author line reads like its delivered rows in
  // Global (persona name + chip), never the raw combined label.
  it("an assistant persona row with a chip drops the workspace text too", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          sourceKind: "workspace-manager",
          sourceLabel: "James · Claw Launcher",
        }),
        workspaceBadge: badge,
      },
    });
    const label = wrapper.find(".role-label");
    expect(label.text()).toContain("James");
    expect(label.text()).not.toContain("Claw Launcher");
    expect(wrapper.get(".workspace-badge .badge-monogram").text()).toBe("CL");
  });

  it("a GLOBAL origin chip renders the house glyph and drops the from-text", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "global-root",
          sourceLabel: "Global",
          body: "@James check the backend",
        }),
        workspaceBadge: {
          name: "Global",
          imageUrl: null,
          monogram: "G",
          accentVar: "",
          isGlobal: true,
        },
      },
    });
    const chip = wrapper.get(".workspace-badge");
    expect(chip.classes()).toContain("is-global");
    expect(chip.find("svg").exists()).toBe(true);
    expect(wrapper.get(".role-label").text()).toContain("Claude");
    expect(wrapper.get(".role-label").text()).not.toContain("from Global");
  });

  it("the host's turn stats grow the door when the row carries none; served stats win", () => {
    const turnStats = {
      model: "claude-fable-5",
      toolCallCount: 4,
      inputTokens: 1500,
      outputTokens: 200,
      contextTokens: 41_500,
      durationMs: 9000,
    };
    const fromTurn = mount(MessageRow, {
      props: { message: makeMessage(), runStats: turnStats },
    });
    expect(fromTurn.find(".run-info").exists()).toBe(true);

    const served = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "Nova",
          body: "hi",
          runStats: { ...turnStats, model: "claude-opus-x" },
        }),
        runStats: turnStats,
      },
    });
    // One door — the served (producing run's) stats, not the turn aggregate.
    expect(served.findAll(".run-info")).toHaveLength(1);
  });

  it("a served runStats grows the info door; without it none renders", () => {
    const withStats = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "James · Claw Launcher",
          body: "hi",
          runStats: {
            model: "claude-x",
            toolCallCount: 3,
            inputTokens: 1200,
            outputTokens: 400,
            contextTokens: 62_000,
            durationMs: 5000,
          },
        }),
        workspaceBadge: badge,
      },
    });
    expect(withStats.find(".run-info").exists()).toBe(true);

    const without = mount(MessageRow, {
      props: {
        message: makeMessage({
          role: "user",
          sourceKind: "agent",
          sourceLabel: "Nova",
          body: "hi",
        }),
      },
    });
    expect(without.find(".run-info").exists()).toBe(false);
    expect(without.find(".workspace-badge").exists()).toBe(false);
  });
});

// TURN folding (Chad, 2026-08-09): a collapsible header row can fold its whole
// message to a strip — author, first-line preview, time, chevron.
describe("MessageRow turn folding (collapsible header)", () => {
  it("folded: only the strip renders — one-line preview, chevron; the body stays hidden", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({
          body: "**First** line here.\n\nSecond paragraph.",
        }),
        collapsible: true,
        collapsed: true,
      },
    });
    expect(wrapper.get(".turn-preview").text()).toBe("First line here.");
    expect(wrapper.find(".collapse-toggle").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Second paragraph.");
  });

  it("expanded: the body shows, no preview; both the chevron and the header emit the toggle", async () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({ body: "Hello world" }),
        collapsible: true,
        collapsed: false,
      },
    });
    expect(wrapper.text()).toContain("Hello world");
    expect(wrapper.find(".turn-preview").exists()).toBe(false);
    await wrapper.get(".collapse-toggle").trigger("click");
    await wrapper.get(".row-header").trigger("click");
    expect(wrapper.emitted("toggleCollapse")).toHaveLength(2);
  });

  it("a plain row (not collapsible) renders exactly as before — no chevron, no strip", () => {
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage({ body: "Plain." }) },
    });
    expect(wrapper.find(".collapse-toggle").exists()).toBe(false);
    expect(wrapper.find(".turn-preview").exists()).toBe(false);
    expect(wrapper.text()).toContain("Plain.");
  });

  it("the ask's time sits BESIDE the author label, never inside it", () => {
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage({ role: "user", body: "Ship it." }) },
    });

    expect(wrapper.get(".role-label").text()).toBe("You");
    expect(wrapper.get(".row-header").text()).toContain("Jul 5");
    expect(wrapper.find(".name-divider").exists()).toBe(true);
  });

  it("the chat icon reports the mark; a plain row has none", async () => {
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage(), collapsible: true },
    });
    await wrapper.get(".reference-toggle").trigger("click");
    expect(wrapper.emitted("toggleReference")).toHaveLength(1);
    expect(wrapper.find(".reference-toggle.is-marked").exists()).toBe(false);

    const marked = mount(MessageRow, {
      props: { message: makeMessage(), collapsible: true, referenced: true },
    });
    expect(marked.find(".reference-toggle.is-marked").exists()).toBe(true);

    // The canvas reaches the icon from both ends of a card — the header and
    // the reply's own line — so a headed reply carries one too.
    const reply = mount(MessageRow, { props: { message: makeMessage() } });
    expect(reply.find(".reference-toggle").exists()).toBe(true);

    // A grouped continuation is not a row you can point at on its own.
    const continuation = mount(MessageRow, {
      props: { message: makeMessage(), showHeader: false },
    });
    expect(continuation.find(".reference-toggle").exists()).toBe(false);

    // Nor is an ask that is not a card header.
    const plainAsk = mount(MessageRow, {
      props: { message: makeMessage({ role: "user", body: "hi" }) },
    });
    expect(plainAsk.find(".reference-toggle").exists()).toBe(false);
  });

  it("a body-less header shows the host's fallback preview; own text wins over it", () => {
    const toolTurn = mount(MessageRow, {
      props: {
        message: makeMessage({ body: "" }),
        collapsible: true,
        collapsed: true,
        previewFallback: "Read CLAUDE.md",
      },
    });
    expect(toolTurn.get(".turn-preview").text()).toBe("Read CLAUDE.md");

    const withText = mount(MessageRow, {
      props: {
        message: makeMessage({ body: "Own first line." }),
        collapsible: true,
        collapsed: true,
        previewFallback: "Read CLAUDE.md",
      },
    });
    expect(withText.get(".turn-preview").text()).toBe("Own first line.");
  });
});

// THE REPLY FOLD (the canvas's reply block): an answer leads with one line and
// keeps its detail behind a caret, so a thread reads as asks + verdicts.
describe("MessageRow reply fold", () => {
  const LONG_DETAIL = `Second paragraph that is comfortably past the fold floor so the caret is worth drawing at all. ${"more detail ".repeat(6)}`;

  it("leads with the first paragraph and holds the rest behind the caret", async () => {
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage({ body: `The verdict line.\n\n${LONG_DETAIL}` }) },
    });

    expect(wrapper.get(".reply-lead").text()).toContain("The verdict line.");
    expect(wrapper.find(".reply-detail").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Second paragraph");

    await wrapper.get(".reply-caret").trigger("click");
    expect(wrapper.get(".reply-detail").text()).toContain("Second paragraph");
  });

  it("the lead line itself opens the fold — the whole line is the control", async () => {
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage({ body: `Lead.\n\n${LONG_DETAIL}` }) },
    });

    await wrapper.get(".reply-lead").trigger("click");
    expect(wrapper.find(".reply-detail").exists()).toBe(true);
  });

  it("a one-paragraph answer renders whole — no caret, nothing hidden", () => {
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage({ body: "Short and done." }) },
    });

    expect(wrapper.text()).toContain("Short and done.");
    expect(wrapper.find(".reply-caret").exists()).toBe(false);
  });

  it("a trivial remainder stays put — a two-line answer grows no caret", () => {
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage({ body: "Done.\n\nNothing else." }) },
    });

    expect(wrapper.text()).toContain("Nothing else.");
    expect(wrapper.find(".reply-caret").exists()).toBe(false);
  });

  it("a grouped continuation carries its caret inline — a fold is never invisible", () => {
    const headed = mount(MessageRow, {
      props: { message: makeMessage({ body: `Lead.\n\n${LONG_DETAIL}` }) },
    });
    expect(headed.find(".reply-caret.is-inline").exists()).toBe(false);

    const continuation = mount(MessageRow, {
      props: {
        message: makeMessage({ body: `Lead.\n\n${LONG_DETAIL}` }),
        showHeader: false,
      },
    });
    expect(continuation.find(".reply-caret.is-inline").exists()).toBe(true);
  });

  it("the run-stats door moves to the lead glyph, and stays one door", () => {
    const stats = {
      model: "claude-fable-5",
      toolCallCount: 4,
      inputTokens: 1500,
      outputTokens: 200,
      contextTokens: 41_500,
      durationMs: 9000,
    };
    const wrapper = mount(MessageRow, {
      props: { message: makeMessage({ body: "Answered." }), runStats: stats },
    });

    expect(wrapper.findAll(".run-info")).toHaveLength(1);
    expect(wrapper.get(".reply-lead").find(".run-info").exists()).toBe(true);
  });

  // The ask is not a reply: it keeps its plain body, never a lead + fold.
  it("a user ask never folds", () => {
    const wrapper = mount(MessageRow, {
      props: {
        message: makeMessage({ role: "user", body: `Ask.\n\n${LONG_DETAIL}` }),
      },
    });

    expect(wrapper.find(".reply-lead").exists()).toBe(false);
    expect(wrapper.text()).toContain("Second paragraph");
  });
});
