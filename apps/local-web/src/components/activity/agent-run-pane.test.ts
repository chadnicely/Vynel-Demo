// The agent-run pane (Kafi, 2026-08-26: the pane IS the agent's card): the
// instruction the agent was given above its activity, the answer below it,
// and — while the row has not reached the detail read yet — the live turn's
// copy of the spawning call, so a click seconds after the spawn never opens
// on "no recorded activity". The registry watch is stubbed: its socket and
// fold are exercised in their own tests.

import { describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type {
  ChatSessionDetailResponse,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import {
  createActiveTurnView,
  type ActiveTurnView,
} from "../../composables/chat/active-turn-view.js";
import AgentRunPane from "./AgentRunPane.vue";

const liveTurn = vi.hoisted(() => ({ view: null as unknown }));
vi.mock("../../composables/chat/use-watched-turn.js", async () => {
  const { computed } = await import("vue");
  return {
    useWatchedTurn: () => ({
      view: computed(() => liveTurn.view),
      errorText: computed(() => null),
      lastTurnErrorText: computed(() => null),
      hasSharedFold: computed(() => false),
    }),
  };
});

function makeAgentCall(overrides: Partial<ChatToolCallResponse> = {}): ChatToolCallResponse {
  return {
    id: "tc-agent",
    parentMessageId: "m1",
    toolUseId: "tu-agent",
    toolName: "Agent",
    toolInput: {
      description: "Whoami check",
      subagent_type: "Explore",
      prompt: "Find who owns the login page.",
    },
    toolOutput: "The login page is owned by **auth**.",
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    subagentNarrative: "Looked around.",
    subagentToolCalls: [
      {
        toolUseId: "n1",
        toolName: "Read",
        toolInput: { file_path: "docs/plan.md" },
        status: "completed",
        startedAt: "2026-08-26T10:00:01.000Z",
        completedAt: "2026-08-26T10:00:02.000Z",
      },
    ],
    startedAt: "2026-08-26T10:00:00.000Z",
    completedAt: "2026-08-26T10:00:05.000Z",
    ...overrides,
  };
}

function makeDetail(calls: ChatToolCallResponse[]): ChatSessionDetailResponse {
  return {
    session: { id: "sess-1", title: "Host" } as never,
    messages: [],
    toolCallsByMessageId: calls.length > 0 ? { m1: calls } : {},
  };
}

function mountPane(detail: ChatSessionDetailResponse) {
  const getSession = vi.fn(async () => detail);
  const wrapper = mount(AgentRunPane, {
    props: { sessionId: "sess-1", toolUseId: "tu-agent" },
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: { root: { getSession } } },
    },
  });
  return { wrapper, getSession };
}

describe("AgentRunPane", () => {
  it("shows the instruction, the activity, and the answer of a settled run", async () => {
    liveTurn.view = null;
    const { wrapper } = mountPane(makeDetail([makeAgentCall()]));
    await vi.waitFor(() => expect(wrapper.text()).toContain("Instruction"));

    expect(wrapper.get(".agent-type").text()).toBe("Explore");
    expect(wrapper.get(".instruction-title").text()).toBe("Whoami check");
    expect(wrapper.get(".instruction-prompt").text()).toBe("Find who owns the login page.");
    expect(wrapper.text()).toContain("Read docs/plan.md");
    expect(wrapper.get(".result .section-heading").text()).toBe("Result");
    expect(wrapper.get(".result-body").text()).toContain("The login page is owned by auth.");
  });

  it("names how a run ended — an error result reads Failed, a user stop reads Stopped", async () => {
    liveTurn.view = null;
    const failed = mountPane(
      makeDetail([makeAgentCall({ isErrorResult: true, toolOutput: "boom" })]),
    );
    await vi.waitFor(() =>
      expect(failed.wrapper.get(".result .section-heading").text()).toBe("Failed"),
    );
    expect(failed.wrapper.get(".result .section-heading").classes()).toContain("is-failed");

    const stopped = mountPane(
      makeDetail([makeAgentCall({ status: "cancelled", toolOutput: "interrupted" })]),
    );
    await vi.waitFor(() =>
      expect(stopped.wrapper.get(".result .section-heading").text()).toBe("Stopped"),
    );
  });

  it("reads the instruction off the LIVE turn before the row reaches the detail read", async () => {
    const runningCall = makeAgentCall({
      status: "started",
      toolOutput: null,
      completedAt: null,
      subagentNarrative: null,
      subagentToolCalls: null,
    });
    const view: ActiveTurnView = {
      ...createActiveTurnView(),
      segments: [{ messageId: "m1", text: "", thinking: "", toolCalls: [runningCall] }],
      agentActivity: {
        "tu-agent": {
          text: "",
          toolCalls: [
            {
              toolUseId: "n1",
              toolName: "Grep",
              toolInput: { pattern: "owner" },
              toolOutput: null,
              status: "started",
              startedAt: "2026-08-26T10:00:01.000Z",
              completedAt: null,
            },
          ],
        },
      },
    };
    liveTurn.view = view;
    const { wrapper } = mountPane(makeDetail([]));
    await vi.waitFor(() => expect(wrapper.text()).toContain("Instruction"));

    expect(wrapper.get(".instruction-title").text()).toBe("Whoami check");
    expect(wrapper.text()).toContain("Grep owner");
    // Still running: no answer yet, and never "no recorded activity".
    expect(wrapper.find(".result").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No recorded activity");
  });
});

// `computed` is imported for the mock factory's type — the factory itself
// re-imports vue lazily (vi.mock hoists above the imports).
void computed;
