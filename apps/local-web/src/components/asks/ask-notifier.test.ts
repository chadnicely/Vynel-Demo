import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import type { AskRequestResponse } from "@vynel/contracts/asks/ask-http";
import AskNotifier from "./AskNotifier.vue";

const PENDING_ASK: AskRequestResponse = {
  id: "ask-1",
  userId: "u1",
  workspaceId: null,
  sessionId: null,
  questions: [
    { id: "audience", label: "Who is this note for?", type: "text" },
    {
      id: "tone",
      label: "What tone should it take?",
      type: "choice",
      options: ["Friendly", "Formal"],
    },
  ],
  answers: null,
  status: "pending",
  createdAt: "2026-07-17T10:00:00.000Z",
  resolvedAt: null,
};

function makeHarness(asks: AskRequestResponse[] = [PENDING_ASK]) {
  const dismissCalls: string[] = [];
  const client = {
    asks: {
      listPending: async () => asks,
      dismiss: async (askId: string) => {
        dismissCalls.push(askId);
        return { ...PENDING_ASK, status: "dismissed" };
      },
      answer: async () => PENDING_ASK,
    },
    // The notifier reads the approval poll to step aside from its corner.
    approvals: { listPending: async () => [] },
  } as unknown as VynelClient;

  const wrapper = mount(AskNotifier, {
    global: {
      plugins: [
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, dismissCalls };
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper
    .findAll("button")
    .find((candidate) => candidate.text() === label);
  if (!button) throw new Error(`no button labeled ${label}`);
  return button;
}

describe("AskNotifier", () => {
  it("shows the newest pending ask with its first question and count", async () => {
    const { wrapper } = makeHarness();
    await flushPromises();

    expect(wrapper.text()).toContain("Claude needs your input");
    expect(wrapper.text()).toContain("Who is this note for?");
    expect(wrapper.text()).toContain("2 quick questions");
    expect(wrapper.text()).toContain(
      "Dismiss lets Claude carry on without your answers.",
    );
  });

  it("counts the asks waiting behind the newest one", async () => {
    const { wrapper } = makeHarness([
      PENDING_ASK,
      { ...PENDING_ASK, id: "ask-2" },
    ]);
    await flushPromises();

    expect(wrapper.text()).toContain("+1 more waiting");
  });

  it("Answer opens the wizard dialog for the ask", async () => {
    const { wrapper } = makeHarness();
    await flushPromises();

    await findButton(wrapper, "Answer").trigger("click");
    await flushPromises();

    // The Modal teleports to document.body — the newest dialog is the last.
    const dialogs = document.body.querySelectorAll('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain("Claude needs your input");
    expect(dialog!.textContent).toContain("Who is this note for?");
  });

  it("Dismiss calls the dismiss mutation with the ask id", async () => {
    const { wrapper, dismissCalls } = makeHarness();
    await flushPromises();

    await findButton(wrapper, "Dismiss").trigger("click");
    await flushPromises();

    expect(dismissCalls).toEqual(["ask-1"]);
  });
});
