import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LiveTurn from "./LiveTurn.vue";
import {
  createActiveTurnView,
  type ActiveTurnApproval,
} from "../../composables/chat/active-turn-view.js";

function makeApproval(toolName: string): ActiveTurnApproval {
  return {
    approvalRequestId: "appr-1",
    parentMessageId: "msg-1",
    toolName,
    toolInput: { command: "rm -rf ./build" },
    requestedAt: "2026-07-07T00:00:00.000Z",
    isResolved: false,
  };
}

function mountWithApproval(toolName: string) {
  return mount(LiveTurn, {
    props: {
      view: { ...createActiveTurnView(), approvals: [makeApproval(toolName)] },
    },
  });
}

describe("LiveTurn segmented rendering", () => {
  it("renders each assistant message as its own block with its tool calls — matching the settled layout", () => {
    const wrapper = mount(LiveTurn, {
      props: {
        view: {
          ...createActiveTurnView(),
          segments: [
            {
              messageId: "m1",
              text: "Reading the file…",
              thinking: "",
              toolCalls: [
                {
                  id: "tc-1",
                  parentMessageId: "m1",
                  toolUseId: "tu-1",
                  toolName: "Read",
                  toolInput: {},
                  toolOutput: null,
                  status: "completed",
                  approvalStatus: null,
                  isErrorResult: false,
                  startedAt: "2026-07-19T10:00:00.000Z",
                  completedAt: "2026-07-19T10:00:01.000Z",
                },
              ],
            },
            {
              messageId: "m2",
              text: "Here's the answer.",
              thinking: "",
              toolCalls: [],
            },
          ],
        },
      },
    });

    const segments = wrapper.findAll(".segment");
    expect(segments).toHaveLength(2);
    // Interleaved: the first block carries its text AND its tool card; the
    // second carries only text — not one flat text blob over one tool pile.
    expect(segments[0]!.text()).toContain("Reading the file…");
    expect(segments[0]!.findAll(".tool-call-card")).toHaveLength(1);
    expect(segments[1]!.text()).toContain("Here's the answer.");
    expect(segments[1]!.findAll(".tool-call-card")).toHaveLength(0);
    // Only the live edge wears the cursor.
    expect(segments[0]!.find(".stream-cursor").exists()).toBe(false);
    expect(segments[1]!.find(".stream-cursor").exists()).toBe(true);
  });
});

describe("LiveTurn live status line", () => {
  it("shows working + elapsed at the live edge while streaming", () => {
    const wrapper = mount(LiveTurn, {
      props: { view: createActiveTurnView() },
    });
    const chip = wrapper.get(".live-status .live-chip");
    expect(chip.text()).toContain("working");
    // The author line stays a plain label — the state lives at the bottom.
    expect(wrapper.get(".role-label").text()).toBe("Assistant");
  });

  it("says thinking while a thinking block is live", () => {
    const wrapper = mount(LiveTurn, {
      props: { view: { ...createActiveTurnView(), isThinkingLive: true } },
    });
    expect(wrapper.get(".live-status .live-chip").text()).toContain("thinking");
  });

  it("settles to a quiet done chip instead of vanishing (the settle-window flicker)", () => {
    const wrapper = mount(LiveTurn, {
      props: { view: { ...createActiveTurnView(), status: "completed" } },
    });
    expect(wrapper.find(".live-chip").exists()).toBe(false);
    expect(wrapper.get(".live-status .done-chip").text()).toContain("done");
  });
});

describe("LiveTurn automatic continuation (checkpoint + auto-continue)", () => {
  it("places the continuation's anchor row where its output begins and says continuing at the live edge", () => {
    const anchorRow = {
      id: "u2",
      sessionId: "seg-b",
      role: "user",
      sourceKind: "global-root",
      sourceLabel: null,
      body: "Continuing after patching context — next: sum the July receipts",
      createdAt: "2026-08-18T10:05:00.000Z",
    } as never;
    const wrapper = mount(LiveTurn, {
      props: {
        view: {
          ...createActiveTurnView(),
          segments: [
            { messageId: "m1", text: "Stopping here to swap.", thinking: "", toolCalls: [] },
            { messageId: "m2", text: "Summing the July receipts…", thinking: "", toolCalls: [] },
          ],
          continuations: [{ userMessage: anchorRow, atSegmentIndex: 1 }],
          contextPatch: { phase: "continuing", fromSessionId: "seg-a", toSessionId: "seg-b" },
        },
      },
    });
    // Order: turn-1 segment, the anchor row, the continuation's segment.
    const rows = wrapper.findAll(".segment, .continuation-row");
    expect(rows.map((row) => row.classes().includes("continuation-row"))).toEqual([false, true, false]);
    expect(rows[1]!.text()).toContain("Continuing after patching context — next: sum the July receipts");
    expect(wrapper.get(".live-status .live-chip").text()).toContain("continuing");
  });

  it("a just-started continuation with no output yet renders its anchor after every segment", () => {
    const anchorRow = {
      id: "u2",
      sessionId: "seg-b",
      role: "user",
      sourceKind: "global-root",
      sourceLabel: null,
      body: "Continuing after patching context — next: keep going",
      createdAt: "2026-08-18T10:05:00.000Z",
    } as never;
    const wrapper = mount(LiveTurn, {
      props: {
        view: {
          ...createActiveTurnView(),
          segments: [{ messageId: "m1", text: "Done with part one.", thinking: "", toolCalls: [] }],
          continuations: [{ userMessage: anchorRow, atSegmentIndex: 1 }],
        },
      },
    });
    const rows = wrapper.findAll(".segment, .continuation-row");
    expect(rows.map((row) => row.classes().includes("continuation-row"))).toEqual([false, true]);
  });
});

describe("LiveTurn inline approval card", () => {
  it("derives the action kind so a shell command renders as danger", () => {
    const wrapper = mountWithApproval("Bash");
    const card = wrapper.find(".approval-card");
    expect(card.classes()).toContain("is-danger");
    expect(card.text()).toContain("wants to run a command");
  });

  it("keeps a file write on the normal gold treatment", () => {
    const wrapper = mountWithApproval("Write");
    const card = wrapper.find(".approval-card");
    expect(card.classes()).not.toContain("is-danger");
    expect(card.text()).toContain("wants to create a file");
  });
});

// The streaming answer and the settled one must READ the same — a thread that
// reformats when a turn completes is the bug this pins. MessageRow renders the
// settled reply with MarkdownText's `reply` variant; this is the other half,
// so the pair can no longer drift silently.
describe("LiveTurn reply voice", () => {
  it("streams the answer in the SAME reply variant the settled row uses", () => {
    const wrapper = mount(LiveTurn, {
      props: {
        view: {
          ...createActiveTurnView(),
          segments: [
            {
              messageId: "m1",
              text: "Answering now.",
              thinking: "",
              toolCalls: [],
            },
          ],
        },
      },
    });

    const markdown = wrapper.find(".answer .markdown-text");
    expect(markdown.exists()).toBe(true);
    expect(markdown.classes()).toContain("is-reply");
  });
});
