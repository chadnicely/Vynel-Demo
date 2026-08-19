// Which session a continuous thread renders. The rule that matters is the
// FALLBACK, used before the primary's first turn is bridged: it binds by
// IDENTITY, and with no identity in hand it binds to nothing at all.
//
// The bug it closes (agents 2, 3, 4, 5): a voice-first user has no global
// head, so the Global chat fell through to the feed reader — which handed
// back the spoken segment. The private conversation then rendered as the
// assistant's thread, stickily, until a typed turn finally ran.

import { describe, expect, it } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
import { useActivityStore } from "../../stores/activity-store.js";
import { useContinuingSessionId } from "./use-continuing-conversation.js";
import type { SessionScope } from "./session-scope.js";

type ContinuingPayload = {
  rootSessionId: string | null;
  currentSdkSessionId: string | null;
} | null;

function started(
  turnId: string,
  overrides: Partial<Extract<SessionActivityEvent, { kind: "turn-started" }>>,
): SessionActivityEvent {
  return {
    kind: "turn-started",
    turnId,
    scopeKind: "global",
    workspaceId: null,
    sessionId: null,
    origin: "web",
    startedAt: "2026-08-19T10:00:00.000Z",
    primarySessionId: null,
    ...overrides,
  };
}

function mountThread(scope: SessionScope, payload: ContinuingPayload) {
  const data = ref<ContinuingPayload>(payload);
  let activity!: ReturnType<typeof useActivityStore>;
  let sessionId!: ReturnType<typeof useContinuingSessionId>;
  const Host = defineComponent({
    setup() {
      activity = useActivityStore();
      sessionId = useContinuingSessionId(
        () => scope,
        { data } as ReturnType<
          typeof import("./use-continuing-conversation.js").useContinuingConversation
        >,
      );
      return () => h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [createPinia()] } });
  return { wrapper, data, activity: () => activity, sessionId: () => sessionId };
}

const GLOBAL: SessionScope = { kind: "global" };

describe("useContinuingSessionId", () => {
  it("renders the primary's head once the continuing read lands", () => {
    const thread = mountThread(GLOBAL, {
      rootSessionId: "global-primary-1",
      currentSdkSessionId: "global-segment-3",
    });
    expect(thread.sessionId().value).toBe("global-segment-3");
  });

  it("binds to the running turn on its OWN identity before the head is bridged", () => {
    const thread = mountThread(GLOBAL, {
      rootSessionId: "global-primary-1",
      currentSdkSessionId: null,
    });
    thread
      .activity()
      .applyServerActivity(
        started("t-root", {
          sessionId: "global-segment-1",
          primarySessionId: "global-primary-1",
        }),
      );
    expect(thread.sessionId().value).toBe("global-segment-1");
  });

  it("NEVER binds the global chat to a running voice turn", () => {
    const thread = mountThread(GLOBAL, {
      rootSessionId: "global-primary-1",
      currentSdkSessionId: null,
    });
    thread.activity().applyServerActivity(
      started("t-voice", {
        scopeKind: "voice",
        origin: "voice",
        sessionId: "voice-segment-1",
        primarySessionId: "voice-primary-1",
      }),
    );
    expect(thread.sessionId().value).toBeNull();
  });

  // The voice-first user: no global thread has ever run, so there is no
  // identity to match. A flash of the welcome hero is fine; a wrong bind is
  // not.
  it("binds to nothing while the thread's identity is unknown", () => {
    const thread = mountThread(GLOBAL, null);
    thread.activity().applyServerActivity(
      started("t-voice", {
        scopeKind: "voice",
        origin: "voice",
        sessionId: "voice-segment-1",
        primarySessionId: "voice-primary-1",
      }),
    );
    expect(thread.sessionId().value).toBeNull();
  });

  it("remembers the running id across the turn-end gap, until the head arrives", async () => {
    const thread = mountThread(GLOBAL, {
      rootSessionId: "global-primary-1",
      currentSdkSessionId: null,
    });
    thread
      .activity()
      .applyServerActivity(
        started("t-root", {
          sessionId: "global-segment-1",
          primarySessionId: "global-primary-1",
        }),
      );
    await nextTick();
    thread.activity().applyServerActivity({
      kind: "turn-ended",
      turnId: "t-root",
      sessionId: "global-segment-1",
      outcome: "ended",
    });
    expect(thread.sessionId().value).toBe("global-segment-1");
  });

  it("a workspace room binds on its own scope — its turns name no primary", () => {
    const thread = mountThread(
      { kind: "workspace", workspaceId: "ws-1" },
      { rootSessionId: "ws-primary-1", currentSdkSessionId: null },
    );
    thread.activity().applyServerActivity(
      started("t-spawned", {
        scopeKind: "workspace",
        workspaceId: "ws-1",
        sessionId: "spawned-segment-1",
        primarySessionId: "spawned-primary-9",
      }),
    );
    expect(thread.sessionId().value).toBeNull();

    thread
      .activity()
      .applyServerActivity(
        started("t-room", { scopeKind: "workspace", workspaceId: "ws-1", sessionId: "room-segment-1" }),
      );
    expect(thread.sessionId().value).toBe("room-segment-1");
  });
});
