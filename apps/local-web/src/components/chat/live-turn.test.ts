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
