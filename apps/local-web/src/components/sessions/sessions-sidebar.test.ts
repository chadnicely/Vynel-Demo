// The Sessions library as the sidebar: the scope filters (global = ONLY the
// root's own child sessions; a workspace = its conversation + its sessions),
// the carried row intents (percent-hidden-until-usage, the status marks with
// their one-line why, the chain fold), what a row click EMITS (the shell
// decides what it means), the back row, and the paged scroll.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import {
  isSessionInScope,
  type SessionsOverviewEntry,
} from "@vynel/contracts/chat/sessions-overview";
import { useActivityStore } from "../../stores/activity-store.js";
import SessionsSidebar from "./SessionsSidebar.vue";

function makeSegment(
  overrides: Partial<SessionsOverviewEntry["segments"][number]> = {},
) {
  return {
    sessionId: "sp-1",
    title: "Research: pricing",
    startedAt: "2026-07-20T10:00:00.000Z",
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    contextTokens: 40_000,
    continuedFromSessionId: null,
    isCurrent: true,
    ...overrides,
  };
}

/** A spawned, global-grounded entry — the global list's native citizen. */
function makeEntry(
  overrides: Partial<SessionsOverviewEntry> = {},
): SessionsOverviewEntry {
  return {
    sessionId: "sp-1",
    primarySessionId: null,
    scope: "spawned",
    workspaceId: null,
    workspaceName: null,
    title: "Research: pricing",
    icon: null,
    model: "claude-opus-4-8",
    contextTokens: 40_000,
    contextWindow: 200_000,
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    statusFacts: {
      setStatus: null,
      statusNote: null,
      statusSetAt: null,
      lastError: null,
      pendingApprovalCount: 0,
      pendingAskCount: 0,
      latestUserMessageAt: null,
    },
    segments: [makeSegment()],
    ...overrides,
  };
}

async function mountSidebar(
  entries: SessionsOverviewEntry[],
  props: {
    workspaceScopeId?: string | null;
    workspaceCard?: {
      name: string;
      imageUrl: string | null;
      initials: string;
      statusLine: string;
      statusTone: "running" | "needs_input" | "problem" | "completed" | "not_running";
    } | null;
    activeSessionId?: string | null;
  } = {},
) {
  // Stands in for the real route, which CURATES and PAGES server-side — the
  // fake applies the same shared predicate and slice, fresh payload per read.
  const client = {
    sessions: {
      overview: async (query?: {
        scope?: "workspace" | "global";
        workspaceId?: string;
        limit?: number;
        offset?: number;
      }) => {
        const scoped =
          query?.scope === undefined
            ? entries
            : entries.filter((entry) =>
                isSessionInScope(
                  entry,
                  query.scope === "global" ? null : (query.workspaceId ?? null),
                ),
              );
        const offset = query?.offset ?? 0;
        return scoped.slice(offset, offset + (query?.limit ?? 50));
      },
    },
  } as unknown as VynelClient;

  const pinia = createPinia();
  const wrapper = mount(SessionsSidebar, {
    props: {
      workspaceScopeId: props.workspaceScopeId ?? null,
      workspaceCard: props.workspaceCard ?? null,
      activeSessionId: props.activeSessionId ?? null,
    },
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
  await flushPromises();
  return { wrapper, pinia };
}

describe("SessionsSidebar", () => {
  it("global lists ONLY the root's own child sessions — no Assistant row, no workspace rows", async () => {
    const { wrapper } = await mountSidebar([
      makeEntry({
        sessionId: "root-1",
        scope: "global",
        title: "Assistant",
        segments: [makeSegment({ sessionId: "root-1", title: "Assistant" })],
      }),
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        title: "Launch plan",
        segments: [makeSegment({ sessionId: "ws-1", title: "Launch plan" })],
      }),
      makeEntry(),
      makeEntry({
        sessionId: "sp-2",
        workspaceId: "w1",
        title: "Room-grounded session",
        segments: [makeSegment({ sessionId: "sp-2", title: "Room-grounded session" })],
      }),
    ]);

    const rows = wrapper.findAll(".session-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text()).toContain("Research: pricing");
    expect(wrapper.text()).not.toContain("Assistant");
    expect(wrapper.text()).not.toContain("Launch plan");
    expect(wrapper.text()).not.toContain("Room-grounded session");
  });

  it("a workspace scope lists that room's conversation and its sessions only", async () => {
    const { wrapper } = await mountSidebar(
      [
        makeEntry(),
        makeEntry({
          sessionId: "ws-1",
          scope: "workspace",
          workspaceId: "w1",
          title: "Launch plan",
          segments: [makeSegment({ sessionId: "ws-1", title: "Launch plan" })],
        }),
        makeEntry({
          sessionId: "sp-2",
          workspaceId: "w1",
          title: "Room session",
          segments: [makeSegment({ sessionId: "sp-2", title: "Room session" })],
        }),
        makeEntry({
          sessionId: "ws-2",
          scope: "workspace",
          workspaceId: "w2",
          title: "Contracts",
          segments: [makeSegment({ sessionId: "ws-2", title: "Contracts" })],
        }),
      ],
      { workspaceScopeId: "w1" },
    );

    expect(wrapper.findAll(".session-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Launch plan");
    expect(wrapper.text()).toContain("Room session");
    expect(wrapper.text()).not.toContain("Research: pricing");
    expect(wrapper.text()).not.toContain("Contracts");
  });

  it("the back row says All Menus and returns to them", async () => {
    const { wrapper } = await mountSidebar([]);
    const back = wrapper.get(".sessions-back");
    expect(back.text()).toBe("All Menus");
    await back.trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
  });

  it("keeps the room's tile under the back row — the column is still the room's", async () => {
    const { wrapper } = await mountSidebar([], {
      workspaceScopeId: "w1",
      workspaceCard: {
        name: "letterman",
        imageUrl: null,
        initials: "LE",
        statusLine: "Nothing running",
        statusTone: "not_running",
      },
    });
    const card = wrapper.get('[data-testid="sidebar-workspace-card"]');
    expect(card.text()).toContain("letterman");
    expect(card.text()).toContain("Nothing running");

    // The global library has no room to name — no tile.
    const global = await mountSidebar([]);
    expect(global.wrapper.find('[data-testid="sidebar-workspace-card"]').exists()).toBe(false);
  });

  it("a row click EMITS the entry — the shell decides what opening means", async () => {
    const { wrapper } = await mountSidebar([makeEntry()]);
    await wrapper.get(".session-row").trigger("click");
    expect(wrapper.emitted("open")?.[0]?.[0]).toMatchObject({ sessionId: "sp-1" });
  });

  it("marks the open conversation's row — through any segment of its chain", async () => {
    const { wrapper } = await mountSidebar(
      [
        makeEntry({
          sessionId: "sp-2",
          segments: [
            makeSegment({ sessionId: "sp-1", isCurrent: false }),
            makeSegment({ sessionId: "sp-2", continuedFromSessionId: "sp-1" }),
          ],
        }),
        makeEntry({
          sessionId: "sp-9",
          title: "Quiet one",
          segments: [makeSegment({ sessionId: "sp-9", title: "Quiet one" })],
        }),
      ],
      // The route still names the segment that was clicked before the swap.
      { activeSessionId: "sp-1" },
    );
    const rows = wrapper.findAll(".session-row");
    expect(rows[0]!.classes()).toContain("is-active");
    expect(rows[1]!.classes()).not.toContain("is-active");
  });

  it("shows the small context percentage only once a session has reported usage", async () => {
    const silent = await mountSidebar([makeEntry({ contextTokens: null })]);
    expect(silent.wrapper.find(".context-percent").exists()).toBe(false);

    const { wrapper } = await mountSidebar([
      makeEntry({ contextTokens: 166_000, contextWindow: 200_000 }),
    ]);
    const percent = wrapper.get(".context-percent");
    expect(percent.text()).toBe("83%");
    expect(percent.attributes("title")).toBe(
      "~166k of 200k · continues automatically near 85%",
    );
  });

  it("the context chip wears its tier — blue with room, yellow in the last stretch, red past the swap", async () => {
    const { wrapper } = await mountSidebar([
      makeEntry({ sessionId: "a", contextTokens: 40_000, contextWindow: 200_000,
        segments: [makeSegment({ sessionId: "a" })] }),
      makeEntry({ sessionId: "b", contextTokens: 160_000, contextWindow: 200_000,
        segments: [makeSegment({ sessionId: "b" })] }),
      makeEntry({ sessionId: "c", contextTokens: 180_000, contextWindow: 200_000,
        segments: [makeSegment({ sessionId: "c" })] }),
    ]);
    expect(
      wrapper
        .findAll(".context-percent")
        .map((chip) => [chip.text(), chip.get(".context-ring").attributes("data-tier")]),
    ).toEqual([
      ["20%", "low"],
      ["80%", "high"],
      ["90%", "critical"],
    ]);
    // The shared ring (@vynel/ui ContextRing) fills its arc to the fraction.
    const fill = wrapper.findAll(".ring-fill")[0]!;
    const dash = Number(fill.attributes("stroke-dasharray"));
    expect(Number(fill.attributes("stroke-dashoffset"))).toBeCloseTo(dash * 0.8, 5);
  });

  it("lights the working dot when the feed reports a turn on the entry's session", async () => {
    const { wrapper, pinia } = await mountSidebar([
      makeEntry(),
      makeEntry({
        sessionId: "sp-2",
        title: "Quiet one",
        segments: [makeSegment({ sessionId: "sp-2", title: "Quiet one" })],
      }),
    ]);
    expect(wrapper.findAll(".working-dot")).toHaveLength(0);

    useActivityStore(pinia).applyServerActivity({
      kind: "turn-started",
      turnId: "t1",
      scopeKind: "global",
      workspaceId: null,
      sessionId: "sp-1",
      origin: "web",
      startedAt: "2026-07-21T10:00:00.000Z",
    });
    await flushPromises();

    const rows = wrapper.findAll(".session-row");
    expect(rows[0]!.find(".working-dot").exists()).toBe(true);
    expect(rows[1]!.find(".working-dot").exists()).toBe(false);
  });

  it("marks a conversation whose last turn errored, and says why", async () => {
    const { wrapper } = await mountSidebar([
      makeEntry({
        statusFacts: {
          setStatus: null,
          statusNote: null,
          statusSetAt: null,
          lastError: {
            code: "error_during_execution",
            message: "You've hit your session limit · resets 2:20pm",
            at: "2026-07-21T10:00:00.000Z",
          },
          pendingApprovalCount: 0,
          pendingAskCount: 0,
          latestUserMessageAt: "2026-07-21T09:59:00.000Z",
        },
      }),
    ]);
    const row = wrapper.get(".session-row");
    expect(row.find('.session-mark[data-status="problem"]').exists()).toBe(true);
    expect(row.text()).toContain("You've hit your session limit · resets 2:20pm");
    expect(row.find(".working-dot").exists()).toBe(false);
  });

  it("a pending approval marks the row as waiting on you", async () => {
    const { wrapper } = await mountSidebar([
      makeEntry({
        statusFacts: {
          setStatus: null,
          statusNote: null,
          statusSetAt: null,
          lastError: null,
          pendingApprovalCount: 1,
          pendingAskCount: 0,
          latestUserMessageAt: null,
        },
      }),
    ]);
    expect(
      wrapper.get(".session-row").find('.session-mark[data-status="needs_input"]').exists(),
    ).toBe(true);
  });

  it("shows the assistant's set status and note", async () => {
    const { wrapper } = await mountSidebar([
      makeEntry({
        statusFacts: {
          setStatus: "completed",
          statusNote: "All three drafts are in your inbox.",
          statusSetAt: "2026-07-21T10:05:00.000Z",
          lastError: null,
          pendingApprovalCount: 0,
          pendingAskCount: 0,
          latestUserMessageAt: "2026-07-21T10:00:00.000Z",
        },
      }),
    ]);
    const row = wrapper.get(".session-row");
    expect(row.find('.session-mark[data-status="completed"]').exists()).toBe(true);
    expect(row.text()).toContain("All three drafts are in your inbox.");
  });

  it("expands a continued conversation into its chain, and a part click EMITS the segment", async () => {
    const { wrapper } = await mountSidebar([
      makeEntry({
        sessionId: "sp-2",
        contextTokens: 20_000,
        segments: [
          makeSegment({ sessionId: "sp-1", contextTokens: 166_000, isCurrent: false }),
          makeSegment({
            sessionId: "sp-2",
            contextTokens: 20_000,
            continuedFromSessionId: "sp-1",
          }),
        ],
      }),
    ]);

    // Collapsed by default; the footnote says it continued.
    expect(wrapper.find(".session-chain").exists()).toBe(false);
    expect(wrapper.text()).toContain("continued 1×");

    await wrapper.get(".chain-toggle").trigger("click");
    const chain = wrapper.get(".session-chain");
    expect(chain.findAll(".chain-node")).toHaveLength(2);
    // The hop wears the PREDECESSOR's fork-time occupancy.
    expect(chain.get(".chain-hop-percent").text()).toBe("83%");
    expect(chain.text()).toContain("current");

    await chain.findAll(".chain-node")[0]!.trigger("click");
    const emitted = wrapper.emitted("open-segment")?.[0];
    expect(emitted?.[0]).toMatchObject({ sessionId: "sp-2" });
    expect(emitted?.[1]).toMatchObject({ sessionId: "sp-1" });
  });

  it("invites conversation when there is nothing yet", async () => {
    const { wrapper } = await mountSidebar([]);
    expect(wrapper.text()).toContain("No conversations yet");
  });
});

// ── Infinite scroll (2026-08-17) ───────────────────────────────────
// jsdom has no IntersectionObserver, so the sentinel's callback is captured
// and fired by hand: what is under test is the list's reaction to the
// sentinel coming into view, not the browser's scroll detection.
describe("SessionsSidebar — infinite scroll", () => {
  let fireIntersection: (() => void) | null = null;

  beforeEach(() => {
    fireIntersection = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe() {
          fireIntersection = () =>
            this.callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
        }
        disconnect() {
          fireIntersection = null;
        }
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function manyEntries(count: number): SessionsOverviewEntry[] {
    return Array.from({ length: count }, (_unused, index) =>
      makeEntry({
        sessionId: `sp-${index}`,
        title: `Conversation ${index}`,
        segments: [makeSegment({ sessionId: `sp-${index}`, title: `Conversation ${index}` })],
      }),
    );
  }

  it("shows one page, then loads the next when the sentinel comes into view", async () => {
    const { wrapper } = await mountSidebar(manyEntries(60));

    expect(wrapper.findAll(".session-row")).toHaveLength(50);
    expect(wrapper.find(".sentinel").exists()).toBe(true);

    fireIntersection?.();
    await flushPromises();

    expect(wrapper.findAll(".session-row")).toHaveLength(60);
    expect(wrapper.text()).toContain("Conversation 0");
  });

  it("stops at the last page — a short page ends the scroll", async () => {
    const { wrapper } = await mountSidebar(manyEntries(60));
    fireIntersection?.();
    await flushPromises();
    expect(wrapper.find(".sentinel").exists()).toBe(false);
  });

  it("a scrolled-in row still gets its status light", async () => {
    const entries = manyEntries(60);
    entries[59] = makeEntry({
      sessionId: "sp-59",
      title: "Conversation 59",
      segments: [makeSegment({ sessionId: "sp-59", title: "Conversation 59" })],
      statusFacts: {
        setStatus: null,
        statusNote: null,
        statusSetAt: null,
        lastError: null,
        pendingApprovalCount: 1,
        pendingAskCount: 0,
        latestUserMessageAt: null,
      },
    });
    const { wrapper } = await mountSidebar(entries);
    fireIntersection?.();
    await flushPromises();

    expect(wrapper.find('.session-mark[data-status="needs_input"]').exists()).toBe(true);
  });
});
