// The B5 card-model builder: one card per in-flight TASK (keyed by its trace
// key), state from the job status, narration + ring via the A8-enriched feed
// turn (matched by partialSessionId), acked via the thread's own rows sharing
// the running turn's CHAIN key (threadId, the A5 settle-match column).

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useTurnNarrationStore } from "../../stores/turn-narration-store.js";
import {
  useLiveDelegationCards,
  type PersonaLiveCardModel,
} from "./use-live-delegation-cards.js";

function makeHarness(options: {
  delegations: unknown[];
  messages?: ChatMessageResponse[];
}) {
  const fakeClient = {
    root: {
      listDelegations: vi.fn(async () => ({ delegations: options.delegations })),
    },
  };
  let cards!: () => PersonaLiveCardModel[];
  let activity!: ReturnType<typeof useActivityStore>;
  let narration!: ReturnType<typeof useTurnNarrationStore>;
  const messages = ref<ChatMessageResponse[]>(options.messages ?? []);
  const Host = defineComponent({
    setup() {
      activity = useActivityStore();
      narration = useTurnNarrationStore();
      const built = useLiveDelegationCards({ messages: () => messages.value });
      cards = () => built.cards.value;
      return () => h("div");
    },
  });
  const wrapper = mount(Host, {
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: fakeClient },
    },
  });
  return { wrapper, cards, activity: () => activity, narration: () => narration };
}

const baseDelegation = {
  partialSessionId: "trace-1",
  workspaceId: null,
  workspaceName: "Nova",
  targetPrimarySessionId: "primary-1",
  sessionName: null,
  taskLabel: "Research WAL mode",
  status: "claimed",
};

describe("useLiveDelegationCards", () => {
  it("builds one card per task: queued vs working, persona from the row", async () => {
    const harness = makeHarness({
      delegations: [
        baseDelegation,
        { ...baseDelegation, partialSessionId: "trace-2", status: "pending" },
      ],
    });
    await vi.waitFor(() => expect(harness.cards()).toHaveLength(2));
    const [working, queued] = harness.cards();
    expect(working).toMatchObject({
      key: "trace-1",
      state: "working",
      taskLabel: "Research WAL mode",
    });
    expect(working!.persona.name).toBe("Nova");
    expect(working!.persona.monogram.length).toBeGreaterThan(0);
    expect(queued).toMatchObject({ key: "trace-2", state: "queued" });
    harness.wrapper.unmount();
  });

  it("links narration + ring + startedAt through the A8-enriched feed turn", async () => {
    const harness = makeHarness({ delegations: [baseDelegation] });
    await vi.waitFor(() => expect(harness.cards()).toHaveLength(1));

    harness.activity().applyServerActivity({
      kind: "turn-started",
      turnId: "turn-1",
      scopeKind: "global",
      workspaceId: null,
      sessionId: null,
      origin: "delegation",
      startedAt: "2026-08-04T10:00:00.000Z",
      partialSessionId: "trace-1",
      threadId: "thread-1",
      personaName: "Nova",
    } as never);
    harness.narration().apply({
      kind: "turn-tool-started",
      turnId: "turn-1",
      toolUseId: "u1",
      toolName: "Read",
      toolInput: { file_path: "wal.md" },
    } as never);

    await vi.waitFor(() => expect(harness.cards()[0]!.narration).toContain("wal.md"));
    const card = harness.cards()[0]!;
    expect(card.startedAt).toBe("2026-08-04T10:00:00.000Z");
    expect(card.recentSteps).toHaveLength(1);
    expect(card.acked).toBe(false);
    harness.wrapper.unmount();
  });

  it("acked flips when an attributed inbound row shares the turn's CHAIN key", async () => {
    const ackRow = {
      id: "ack-1",
      role: "user",
      sourceKind: "agent",
      sourceLabel: "Nova",
      threadId: "thread-1",
      body: "[Update from Nova] Received.",
    } as never as ChatMessageResponse;
    const harness = makeHarness({
      delegations: [baseDelegation],
      messages: [ackRow],
    });
    await vi.waitFor(() => expect(harness.cards()).toHaveLength(1));
    expect(harness.cards()[0]!.acked).toBe(false); // no turn yet — no chain key

    harness.activity().applyServerActivity({
      kind: "turn-started",
      turnId: "turn-1",
      scopeKind: "global",
      workspaceId: null,
      sessionId: null,
      origin: "delegation",
      startedAt: "2026-08-04T10:00:00.000Z",
      partialSessionId: "trace-1",
      threadId: "thread-1",
    } as never);
    await vi.waitFor(() => expect(harness.cards()[0]!.acked).toBe(true));
    harness.wrapper.unmount();
  });
});
