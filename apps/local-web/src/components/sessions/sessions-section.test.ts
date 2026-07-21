import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { useActivityStore } from "../../stores/activity-store.js";
import { useActivityMonitorStore } from "../../stores/activity-monitor-store.js";
import SessionsSection from "./SessionsSection.vue";

function makeSegment(
  overrides: Partial<SessionsOverviewEntry["segments"][number]> = {},
) {
  return {
    sessionId: "seg-1",
    title: "Ongoing conversation",
    startedAt: "2026-07-20T10:00:00.000Z",
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    contextTokens: 40_000,
    continuedFromSessionId: null,
    isCurrent: true,
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<SessionsOverviewEntry> = {},
): SessionsOverviewEntry {
  return {
    sessionId: "seg-1",
    scope: "global",
    workspaceId: null,
    workspaceName: null,
    title: "Ongoing conversation",
    model: "claude-opus-4-8",
    contextTokens: 40_000,
    contextWindow: 200_000,
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    segments: [makeSegment()],
    ...overrides,
  };
}

function mountSection(entries: SessionsOverviewEntry[]) {
  const client = {
    sessions: { overview: async () => entries },
  } as unknown as VynelClient;
  const pinia = createPinia();
  const wrapper = mount(SessionsSection, {
    global: {
      plugins: [
        pinia,
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
  return { wrapper, pinia };
}

describe("SessionsSection", () => {
  it("lists every scope with its identity: the brain as Assistant, rooms by name", async () => {
    const { wrapper } = mountSection([
      makeEntry(),
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        workspaceName: "Marketing",
        title: "Launch plan",
        segments: [makeSegment({ sessionId: "ws-1", title: "Launch plan" })],
      }),
    ]);
    await flushPromises();

    const rows = wrapper.findAll(".session-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("Assistant");
    expect(rows[1]!.text()).toContain("Marketing");
    expect(rows[1]!.text()).toContain("Launch plan");
  });

  it("shows the context meter with the occupancy and the friendly tooltip", async () => {
    const { wrapper } = mountSection([
      makeEntry({ contextTokens: 166_000, contextWindow: 200_000 }),
    ]);
    await flushPromises();

    const meter = wrapper.get(".context-meter");
    expect(meter.attributes("aria-valuenow")).toBe("83");
    expect(meter.classes()).toContain("is-warn");
    expect(meter.attributes("title")).toBe(
      "~166k of 200k · continues automatically near 85%",
    );
  });

  it("hides the meter until a session has reported usage", async () => {
    const { wrapper } = mountSection([makeEntry({ contextTokens: null })]);
    await flushPromises();

    expect(wrapper.find(".context-meter").exists()).toBe(false);
  });

  it("lights the working dot from the activity feed, per scope", async () => {
    const { wrapper, pinia } = mountSection([
      makeEntry(),
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        workspaceName: "Marketing",
      }),
    ]);
    await flushPromises();
    expect(wrapper.findAll(".working-dot")).toHaveLength(0);

    const activity = useActivityStore(pinia);
    activity.applyServerActivity({
      kind: "turn-started",
      turnId: "t1",
      scopeKind: "workspace",
      workspaceId: "w1",
      sessionId: "ws-1",
      origin: "web",
      startedAt: "2026-07-21T10:00:00.000Z",
    });
    await flushPromises();

    const rows = wrapper.findAll(".session-row");
    expect(rows[0]!.find(".working-dot").exists()).toBe(false);
    expect(rows[1]!.find(".working-dot").exists()).toBe(true);
  });

  it("expands a continued conversation into its chain with fork percentages", async () => {
    const { wrapper } = mountSection([
      makeEntry({
        sessionId: "seg-2",
        contextTokens: 20_000,
        segments: [
          makeSegment({
            sessionId: "seg-1",
            contextTokens: 166_000,
            isCurrent: false,
          }),
          makeSegment({
            sessionId: "seg-2",
            contextTokens: 20_000,
            continuedFromSessionId: "seg-1",
          }),
        ],
      }),
    ]);
    await flushPromises();

    // Collapsed by default; the sub-line says it continued.
    expect(wrapper.find(".session-chain").exists()).toBe(false);
    expect(wrapper.text()).toContain("continued 1×");

    await wrapper.get(".chain-toggle").trigger("click");
    const chain = wrapper.get(".session-chain");
    expect(chain.findAll(".chain-node")).toHaveLength(2);
    // The hop wears the PREDECESSOR's fork-time occupancy.
    expect(chain.get(".chain-hop-percent").text()).toBe("83%");
    expect(chain.text()).toContain("current");
    expect(chain.text()).toContain("continued automatically");
  });

  it("Watch opens the live view for that session, labeled by its identity", async () => {
    const { wrapper, pinia } = mountSection([
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        workspaceName: "Marketing",
        title: "Launch plan",
      }),
    ]);
    await flushPromises();

    await wrapper.get(".watch-button").trigger("click");

    const monitorStore = useActivityMonitorStore(pinia);
    expect(monitorStore.current).toEqual({
      kind: "session",
      sessionId: "ws-1",
      title: "Marketing · Launch plan",
    });
  });

  it("invites conversation when there is nothing yet", async () => {
    const { wrapper } = mountSection([]);
    await flushPromises();

    expect(wrapper.text()).toContain("No conversations yet");
  });
});
