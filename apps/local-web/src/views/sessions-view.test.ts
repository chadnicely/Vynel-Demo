// The routed session library (sessions-surface Slice ③b): scope-filtered
// listing, the open decisions (spawned → chattable thread · superseded chain
// part → view-only · primary → its Chat), the session-turn composer over
// `POST /sessions/:id/turn` (queued sentinel included), and the coverage
// carried over from the retired left-nav SessionsSection (identity labels,
// context meter, working dot, Watch → the monitor store).

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createAppRouter } from "../router.js";
import { vynelClientKey } from "../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { useActivityStore } from "../stores/activity-store.js";
import { useActivityMonitorStore } from "../stores/activity-monitor-store.js";
import { useUiStore } from "../stores/ui-store.js";
import SessionsView from "./SessionsView.vue";

function sseFrame(kind: string, payload: object): Uint8Array {
  return new TextEncoder().encode(
    `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

/** A controllable SSE body: the test pushes frames / closes. */
function makeStreamHandle() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (kind: string, payload: object) =>
      controller.enqueue(sseFrame(kind, payload)),
    failWith: (error: Error) => controller.error(error),
    close: () => controller.close(),
  };
}

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

function makeTranscript(messages: Array<{ id: string; body: string }>) {
  return {
    session: { id: "sdk-1" },
    messages: messages.map((message) => ({
      id: message.id,
      role: "assistant",
      sourceKind: null,
      sourceLabel: null,
      body: message.body,
    })),
    toolCallsByMessageId: {},
  };
}

async function mountView(
  entries: SessionsOverviewEntry[],
  options: {
    path?: string;
    onTurnRequest?: () => ReadableStream<Uint8Array>;
    /** Overrides the turn POST's response envelope (e.g. a stale-handle 404). */
    turnResponse?: { ok: boolean; status: number };
  } = {},
) {
  const getSession = vi.fn(async () =>
    makeTranscript([{ id: "m-1", body: "Earlier findings." }]),
  );
  const turnCalls: Array<{ path: string; init: Record<string, unknown> }> = [];
  const POST = vi.fn(async (path: string, init: Record<string, unknown>) => {
    turnCalls.push({ path, init });
    const response = options.turnResponse ?? { ok: true, status: 200 };
    if (!response.ok) return { data: undefined, response };
    const stream = options.onTurnRequest?.() ?? makeStreamHandle().stream;
    return { data: stream, response };
  });
  const client = {
    sessions: { overview: async () => entries },
    workspaces: {
      list: async () => [
        { id: "w1", name: "Marketing", isArchived: false },
        { id: "w2", name: "Legal", isArchived: false },
      ],
    },
    root: {
      getSession,
      getTrace: async () => ({ status: "completed", entries: [] }),
    },
    // The monitor's session channel — parked open (no frames) by default.
    GET: vi.fn(async () => ({
      data: makeStreamHandle().stream,
      response: { ok: true, status: 200 },
    })),
    POST,
  } as unknown as VynelClient;

  const pinia = createPinia();
  const router = createAppRouter();
  await router.push(options.path ?? "/sessions");
  await router.isReady();
  const wrapper = mount(SessionsView, {
    global: {
      plugins: [
        router,
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
  return { wrapper, pinia, router, getSession, turnCalls };
}

describe("SessionsView", () => {
  it("lists every scope in global: the brain as Assistant, rooms and spawned sessions by name", async () => {
    const { wrapper } = await mountView([
      makeEntry(),
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        workspaceName: "Marketing",
        title: "Launch plan",
        segments: [makeSegment({ sessionId: "ws-1", title: "Launch plan" })],
      }),
      makeEntry({
        sessionId: "sp-1",
        scope: "spawned",
        title: "Research: pricing",
        segments: [makeSegment({ sessionId: "sp-1", title: "Research: pricing" })],
      }),
    ]);

    const rows = wrapper.findAll(".session-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.text()).toContain("Assistant");
    expect(rows[1]!.text()).toContain("Marketing");
    expect(rows[1]!.text()).toContain("Launch plan");
    expect(rows[2]!.text()).toContain("Session");
    expect(rows[2]!.text()).toContain("Research: pricing");
  });

  it("a workspace scope lists only that room's sessions — its chain and its spawned children", async () => {
    const { wrapper } = await mountView(
      [
        makeEntry(),
        makeEntry({
          sessionId: "ws-1",
          scope: "workspace",
          workspaceId: "w1",
          workspaceName: "Marketing",
          title: "Launch plan",
        }),
        makeEntry({
          sessionId: "sp-1",
          scope: "spawned",
          workspaceId: "w1",
          workspaceName: "Marketing",
          title: "Research: pricing",
        }),
        makeEntry({
          sessionId: "ws-2",
          scope: "workspace",
          workspaceId: "w2",
          workspaceName: "Legal",
          title: "Contracts",
        }),
      ],
      { path: "/sessions?workspace=w1" },
    );

    const rows = wrapper.findAll(".session-row");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Launch plan");
    expect(wrapper.text()).toContain("Research: pricing");
    expect(wrapper.text()).not.toContain("Assistant");
    expect(wrapper.text()).not.toContain("Contracts");
    expect(wrapper.text()).toContain("Marketing");
  });

  it("shows the context meter with the occupancy and the friendly tooltip", async () => {
    const { wrapper } = await mountView([
      makeEntry({ contextTokens: 166_000, contextWindow: 200_000 }),
    ]);

    const meter = wrapper.get(".context-meter");
    expect(meter.attributes("aria-valuenow")).toBe("83");
    expect(meter.attributes("title")).toBe(
      "~166k of 200k · continues automatically near 85%",
    );
  });

  it("lights the working dot from the activity feed, per scope", async () => {
    const { wrapper, pinia } = await mountView([
      makeEntry(),
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        workspaceName: "Marketing",
      }),
    ]);
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

  it("Watch opens the live overlay for that session, labeled by its identity", async () => {
    const { wrapper, pinia } = await mountView([
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        workspaceName: "Marketing",
        title: "Launch plan",
      }),
    ]);

    await wrapper.get(".watch-button").trigger("click");

    const monitorStore = useActivityMonitorStore(pinia);
    expect(monitorStore.current).toEqual({
      kind: "session",
      sessionId: "ws-1",
      title: "Marketing · Launch plan",
    });
  });

  it("opening a spawned session shows the full thread with a composer", async () => {
    const { wrapper, getSession } = await mountView([
      makeEntry({
        sessionId: "sp-1",
        scope: "spawned",
        title: "Research: pricing",
        segments: [makeSegment({ sessionId: "sp-1", title: "Research: pricing" })],
      }),
    ]);

    await wrapper.get(".open-button").trigger("click");
    await flushPromises();

    // The transcript renders through the monitor seam (root read, any scope).
    expect(getSession).toHaveBeenCalledWith("sp-1");
    expect(wrapper.text()).toContain("Earlier findings.");
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find(".view-only-note").exists()).toBe(false);
    // Text-only surface: the attach affordance is gone entirely (the route
    // takes no files — nothing to lose a typed message to).
    expect(wrapper.find('[aria-label="Attach files"]').exists()).toBe(false);

    // Back returns to the list.
    await wrapper.get(".back-button").trigger("click");
    expect(wrapper.findAll(".session-row")).toHaveLength(1);
  });

  it("sending posts to the session-turn route and shows the queued state on the sentinel", async () => {
    const turnStream = makeStreamHandle();
    const { wrapper, turnCalls } = await mountView(
      [
        makeEntry({
          sessionId: "sp-1",
          scope: "spawned",
          title: "Research: pricing",
          segments: [
            makeSegment({ sessionId: "sp-1", title: "Research: pricing" }),
          ],
        }),
      ],
      { onTurnRequest: () => turnStream.stream },
    );

    await wrapper.get(".open-button").trigger("click");
    await flushPromises();

    const input = wrapper.get("textarea");
    await input.setValue("What did you find?");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(turnCalls).toHaveLength(1);
    expect(turnCalls[0]!.path).toBe("/sessions/{sessionId}/turn");
    expect(turnCalls[0]!.init).toMatchObject({
      params: { path: { sessionId: "sp-1" } },
      body: { userMessageText: "What did you find?" },
      parseAs: "stream",
    });

    // Parked behind a running task — the composer says so instead of freezing.
    turnStream.push("turn-queued", {});
    await flushPromises();
    expect(wrapper.text()).toContain(
      "Working on a task — your message is queued.",
    );

    // The first real frame clears the queued note and streams the reply.
    turnStream.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "Found three pricing tiers.",
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain(
      "Working on a task — your message is queued.",
    );
    expect(wrapper.text()).toContain("Found three pricing tiers.");
  });

  it("a failed turn keeps the transcript rendered and says the error beside the composer", async () => {
    const turnStream = makeStreamHandle();
    const { wrapper } = await mountView(
      [
        makeEntry({
          sessionId: "sp-1",
          scope: "spawned",
          title: "Research: pricing",
          segments: [
            makeSegment({ sessionId: "sp-1", title: "Research: pricing" }),
          ],
        }),
      ],
      { onTurnRequest: () => turnStream.stream },
    );

    await wrapper.get(".open-button").trigger("click");
    await flushPromises();

    const input = wrapper.get("textarea");
    await input.setValue("hello");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    // The stream drops mid-turn — the thread must NOT blank (the list's
    // states are exclusive; the turn error lives beside the composer).
    turnStream.failWith(new Error("network gone"));
    await flushPromises();

    expect(wrapper.text()).toContain("Earlier findings.");
    expect(wrapper.get(".turn-error-note").text()).toBe("network gone");
  });

  it("a stale-handle 404 reads as 'the session moved', transcript intact", async () => {
    const { wrapper } = await mountView(
      [
        makeEntry({
          sessionId: "sp-1",
          scope: "spawned",
          title: "Research: pricing",
          segments: [
            makeSegment({ sessionId: "sp-1", title: "Research: pricing" }),
          ],
        }),
      ],
      { turnResponse: { ok: false, status: 404 } },
    );

    await wrapper.get(".open-button").trigger("click");
    await flushPromises();

    const input = wrapper.get("textarea");
    await input.setValue("hello");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.text()).toContain("Earlier findings.");
    expect(wrapper.get(".turn-error-note").text()).toBe(
      "This session has moved — go back and reopen it.",
    );
  });

  it("hides the context meter until a session has reported usage", async () => {
    const { wrapper } = await mountView([makeEntry({ contextTokens: null })]);

    expect(wrapper.find(".context-meter").exists()).toBe(false);
  });

  it("expands a continued conversation into its chain with fork percentages", async () => {
    const { wrapper } = await mountView([
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

  it("a superseded chain part opens view-only — no composer, chat continues at the head", async () => {
    const { wrapper } = await mountView([
      makeEntry({
        sessionId: "sp-2",
        scope: "spawned",
        title: "Research: pricing",
        segments: [
          makeSegment({
            sessionId: "sp-1",
            title: "Research: pricing",
            isCurrent: false,
          }),
          makeSegment({
            sessionId: "sp-2",
            title: "Continued conversation",
            continuedFromSessionId: "sp-1",
          }),
        ],
      }),
    ]);

    await wrapper.get(".chain-toggle").trigger("click");
    // The first chain node is the superseded part.
    await wrapper.findAll(".chain-node")[0]!.trigger("click");
    await flushPromises();

    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.get(".view-only-note").text()).toContain(
      "chat carries on at the newest part",
    );
  });

  it("a primary entry routes to its Chat — global to the brain, a room to its workspace", async () => {
    const { wrapper, router, pinia } = await mountView([
      makeEntry(),
      makeEntry({
        sessionId: "ws-1",
        scope: "workspace",
        workspaceId: "w1",
        workspaceName: "Marketing",
        title: "Launch plan",
      }),
    ]);

    await wrapper.findAll(".open-button")[0]!.trigger("click");
    // The target routes lazy-load their view chunk — settle the import first.
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("chat");

    await router.push("/sessions");
    await flushPromises();
    await wrapper.findAll(".open-button")[1]!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("workspace");
    expect(useUiStore(pinia).activeWorkspaceId).toBe("w1");
  });

  it("invites conversation when there is nothing yet", async () => {
    const { wrapper } = await mountView([]);
    expect(wrapper.text()).toContain("No conversations yet");
  });
});
