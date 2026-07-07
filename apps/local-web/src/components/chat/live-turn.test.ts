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
