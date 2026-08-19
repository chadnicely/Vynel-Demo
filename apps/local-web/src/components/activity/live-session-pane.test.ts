// The B6 pane wrapper: the monitor's session node resolves against the
// overview — scope drives the direct-send rule (spawned AND agent colleagues
// chat directly, G5), the entry's title wins over the node's, and an
// unresolved id stays view-only with no note (honest while loading). The
// thread machinery itself is SessionThreadView's — stubbed here.

import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import LiveSessionPane from "./LiveSessionPane.vue";

const SessionThreadViewStub = defineComponent({
  name: "SessionThreadView",
  props: ["sessionId", "title", "chattable", "viewOnlyNote", "followChain"],
  template: "<div data-testid='thread-stub' />",
});

function makeEntry(
  overrides: Partial<SessionsOverviewEntry> = {},
): SessionsOverviewEntry {
  return {
    sessionId: "sdk-1",
    primarySessionId: null,
    scope: "spawned",
    workspaceId: null,
    workspaceName: null,
    title: "Research helper",
    model: null,
    contextTokens: null,
    contextWindow: 200_000,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    // Quiet by default (Move 3): no set state, no error, nothing pending —
    // these fixtures exercise the row/chain shape, not the status ladder.
    statusFacts: {
      setStatus: null,
      statusNote: null,
      statusSetAt: null,
      lastError: null,
      pendingApprovalCount: 0,
      pendingAskCount: 0,
      latestUserMessageAt: null,
    },
    segments: [
      {
        sessionId: "sdk-1",
        title: "Research helper",
        startedAt: "2026-08-04T09:00:00.000Z",
        lastMessageAt: "2026-08-04T10:00:00.000Z",
        contextTokens: null,
        continuedFromSessionId: null,
        isCurrent: true,
      },
    ],
    ...overrides,
  };
}

function makeHarness(entries: SessionsOverviewEntry[], sessionId = "sdk-1") {
  const overview = vi.fn(async () => entries);
  const wrapper = mount(LiveSessionPane, {
    props: { sessionId, title: "Node title" },
    global: {
      stubs: { SessionThreadView: SessionThreadViewStub },
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
      provide: { [vynelClientKey as symbol]: { sessions: { overview } } },
    },
  });
  return { wrapper, overview };
}

describe("LiveSessionPane", () => {
  it("a spawned entry chats directly, titled by the entry", async () => {
    const harness = makeHarness([makeEntry()]);
    await vi.waitFor(() =>
      expect(
        harness.wrapper.getComponent(SessionThreadViewStub).props(),
      ).toMatchObject({ chattable: true, viewOnlyNote: null }),
    );
    expect(
      harness.wrapper.getComponent(SessionThreadViewStub).props(),
    ).toMatchObject({
      sessionId: "sdk-1",
      title: "Research helper",
      followChain: true,
    });
    harness.wrapper.unmount();
  });

  // test: correct expectation — G5 shipped (redesign D7): a colleague chats
  // directly from the pane, same semantics as a mention (was view-only).
  it("an agent colleague chats directly from the pane (G5)", async () => {
    const harness = makeHarness([makeEntry({ scope: "agent", title: "Nova" })]);
    await vi.waitFor(() =>
      expect(
        harness.wrapper.getComponent(SessionThreadViewStub).props(),
      ).toMatchObject({ chattable: true, viewOnlyNote: null, title: "Nova" }),
    );
    harness.wrapper.unmount();
  });

  it("resolves through an EARLIER segment id to the entry (a drilled node may hold an old hop id)", async () => {
    const entry = makeEntry({
      sessionId: "sdk-new",
      segments: [
        {
          sessionId: "sdk-old",
          title: "Research helper",
          startedAt: "2026-08-04T09:00:00.000Z",
          lastMessageAt: "2026-08-04T09:30:00.000Z",
          contextTokens: null,
          continuedFromSessionId: null,
          isCurrent: false,
        },
        {
          sessionId: "sdk-new",
          title: "Research helper",
          startedAt: "2026-08-04T09:30:00.000Z",
          lastMessageAt: "2026-08-04T10:00:00.000Z",
          contextTokens: null,
          continuedFromSessionId: "sdk-old",
          isCurrent: true,
        },
      ],
    });
    const harness = makeHarness([entry], "sdk-old");
    await vi.waitFor(() =>
      expect(
        harness.wrapper.getComponent(SessionThreadViewStub).props("chattable"),
      ).toBe(true),
    );
    // The stub keeps the NODE's id — SessionThreadView itself follows the
    // chain (followChain) to the newest head.
    expect(
      harness.wrapper.getComponent(SessionThreadViewStub).props("sessionId"),
    ).toBe("sdk-old");
    harness.wrapper.unmount();
  });

  it("an unresolved id renders view-only with no note — honest while loading", async () => {
    const harness = makeHarness([], "sdk-unknown");
    await vi.waitFor(() => expect(harness.overview).toHaveBeenCalled());
    const props = harness.wrapper.getComponent(SessionThreadViewStub).props();
    expect(props).toMatchObject({
      chattable: false,
      viewOnlyNote: null,
      title: "Node title",
    });
    harness.wrapper.unmount();
  });
});
