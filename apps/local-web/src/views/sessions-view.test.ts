// The routed session library (sessions-surface Slice ③b, simplified layout):
// the two-pane Conversations-panel shape — plain list rows (name, time, small
// context %, working dot) beside the selected session rendered as a NORMAL
// chat (ThreadStream). Pins: the scope filters (global = ONLY the root's own
// child sessions; a workspace = its conversation + its sessions), the open
// decisions (spawned → chattable · superseded part → view-only · primary →
// its Chat), the session-turn composer (queued sentinel, error notes), and
// the carried list intents (percent-hidden-until-usage, chain pins).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createAppRouter } from "../router.js";
import { vynelClientKey } from "../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import {
  isSessionInScope,
  type SessionsOverviewEntry,
} from "@vynel/contracts/chat/sessions-overview";
import { useActivityStore } from "../stores/activity-store.js";
import { useUiStore } from "../stores/ui-store.js";
import SessionsView from "./SessionsView.vue";

function sseFrame(kind: string, payload: object): Uint8Array {
  return new TextEncoder().encode(
    `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

/** A controllable SSE body: the test pushes frames / fails / closes. */
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
    model: "claude-opus-4-8",
    contextTokens: 40_000,
    contextWindow: 200_000,
    lastMessageAt: "2026-07-21T10:00:00.000Z",
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
    segments: [makeSegment()],
    ...overrides,
  };
}

/** Full wire-shaped message rows — MessageRow renders the real contract.
 *  Extra per-row fields (attribution, trace keys) ride via the overrides. */
function makeTranscript(
  messages: Array<{ id: string; body: string } & Record<string, unknown>>,
) {
  return {
    session: { id: "sdk-1" },
    messages: messages.map(({ id, body, ...overrides }) => ({
      id,
      sessionId: "sp-1",
      role: "assistant",
      body,
      thinkingBody: null,
      inputTokens: null,
      outputTokens: null,
      attachedImagesMetadata: null,
      errorCode: null,
      errorMessage: null,
      startedAt: "2026-07-21T09:00:00.000Z",
      completedAt: "2026-07-21T09:00:01.000Z",
      createdAt: "2026-07-21T09:00:00.000Z",
      ...overrides,
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
    /** The transcript read fails (stale handle, deleted session). */
    detailError?: string;
    /** Override the opened session's transcript rows. */
    transcriptMessages?: Array<{ id: string; body: string } & Record<string, unknown>>;
  } = {},
) {
  // A followed chain reads the chain-spanning transcript; a deliberately
  // opened earlier part reads its own segment — both serve the same envelope.
  const getSessionTranscript = vi.fn(async () => {
    if (options.detailError !== undefined)
      throw new Error(options.detailError);
    return makeTranscript(
      options.transcriptMessages ?? [{ id: "m-1", body: "Earlier findings." }],
    );
  });
  const getSession = vi.fn(async () => {
    if (options.detailError !== undefined)
      throw new Error(options.detailError);
    return makeTranscript(
      options.transcriptMessages ?? [{ id: "m-1", body: "Earlier findings." }],
    );
  });
  const turnCalls: Array<{ path: string; init: Record<string, unknown> }> = [];
  const POST = vi.fn(async (path: string, init: Record<string, unknown>) => {
    turnCalls.push({ path, init });
    const response = options.turnResponse ?? { ok: true, status: 200 };
    if (!response.ok) return { data: undefined, response };
    const stream = options.onTurnRequest?.() ?? makeStreamHandle().stream;
    return { data: stream, response };
  });
  // The opened thread holds a STANDING registry watch on its session (B6) —
  // serve the observe stream quietly so the watch attaches like production.
  const GET = vi.fn(async () => ({
    data: makeStreamHandle().stream,
    response: { ok: true, status: 200 },
  }));
  const client = {
    // Stands in for the real route, which CURATES and PAGES server-side
    // (2026-08-17) — so the fake applies the same shared predicate and slice.
    // Returning everything regardless of scope would let a broken scope or a
    // broken page pass here. Fresh payload per read (like the route): handing
    // back the caller's array by reference would defeat structural sharing
    // when a test mutates it to simulate a server-side change.
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
                isSessionInScope(entry, query.scope === "global" ? null : (query.workspaceId ?? null)),
              );
        const offset = query?.offset ?? 0;
        return scoped.slice(offset, offset + (query?.limit ?? 50));
      },
    },
    root: { getSession, getSessionTranscript },
    GET,
    POST,
  } as unknown as VynelClient;

  const pinia = createPinia();
  const router = createAppRouter();
  await router.push(options.path ?? "/sessions");
  await router.isReady();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = mount(SessionsView, {
    global: {
      plugins: [router, pinia, [VueQueryPlugin, { queryClient }]],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  await flushPromises();
  return {
    wrapper,
    pinia,
    router,
    getSession,
    getSessionTranscript,
    turnCalls,
    queryClient,
  };
}

/** Open the first (or given) list row and settle the pane. */
async function openRow(
  wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"],
  index = 0,
) {
  await wrapper.findAll(".session-row")[index]!.trigger("click");
  await flushPromises();
}

describe("SessionsView", () => {
  it("global lists ONLY the root's own child sessions — no Assistant row, no workspace rows", async () => {
    const { wrapper } = await mountView([
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
        workspaceName: "Marketing",
        title: "Launch plan",
        segments: [makeSegment({ sessionId: "ws-1", title: "Launch plan" })],
      }),
      makeEntry(),
      makeEntry({
        sessionId: "sp-2",
        scope: "spawned",
        workspaceId: "w1",
        workspaceName: "Marketing",
        title: "Room-grounded session",
        segments: [
          makeSegment({ sessionId: "sp-2", title: "Room-grounded session" }),
        ],
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
    const { wrapper } = await mountView(
      [
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
          sessionId: "sp-2",
          scope: "spawned",
          workspaceId: "w1",
          workspaceName: "Marketing",
          title: "Room session",
          segments: [makeSegment({ sessionId: "sp-2", title: "Room session" })],
        }),
        makeEntry({
          sessionId: "ws-2",
          scope: "workspace",
          workspaceId: "w2",
          workspaceName: "Legal",
          title: "Contracts",
          segments: [makeSegment({ sessionId: "ws-2", title: "Contracts" })],
        }),
      ],
      { path: "/sessions?workspace=w1" },
    );

    const rows = wrapper.findAll(".session-row");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Launch plan");
    expect(wrapper.text()).toContain("Room session");
    expect(wrapper.text()).not.toContain("Research: pricing");
    expect(wrapper.text()).not.toContain("Contracts");
  });

  it("shows the small context percentage only once a session has reported usage", async () => {
    const silent = await mountView([makeEntry({ contextTokens: null })]);
    expect(silent.wrapper.find(".context-percent").exists()).toBe(false);

    const { wrapper } = await mountView([
      makeEntry({ contextTokens: 166_000, contextWindow: 200_000 }),
    ]);
    const percent = wrapper.get(".context-percent");
    expect(percent.text()).toBe("83%");
    expect(percent.attributes("title")).toBe(
      "~166k of 200k · continues automatically near 85%",
    );
  });

  it("lights the working dot when the feed reports a turn on the entry's session", async () => {
    const { wrapper, pinia } = await mountView([
      makeEntry(),
      makeEntry({
        sessionId: "sp-2",
        segments: [makeSegment({ sessionId: "sp-2", title: "Quiet one" })],
        title: "Quiet one",
      }),
    ]);
    expect(wrapper.findAll(".working-dot")).toHaveLength(0);

    const activity = useActivityStore(pinia);
    activity.applyServerActivity({
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

  // Move 3: the error that used to live ONLY as red text inside the
  // transcript now marks the conversation itself — the whole point of the
  // status arc ("we need to know it's on an error so we can focus").
  it("marks a conversation whose last turn errored, and says why", async () => {
    const { wrapper } = await mountView([
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

    const row = wrapper.findAll(".session-row")[0]!;
    expect(row.find('.session-mark[data-status="problem"]').exists()).toBe(true);
    expect(row.text()).toContain("You've hit your session limit · resets 2:20pm");
    // A stopped conversation is not a working one.
    expect(row.find(".working-dot").exists()).toBe(false);
  });

  it("a pending approval marks the row as waiting on you", async () => {
    const { wrapper } = await mountView([
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
    const row = wrapper.findAll(".session-row")[0]!;
    expect(row.find('.session-mark[data-status="needs_input"]').exists()).toBe(
      true,
    );
  });

  // The assistant's own light, with its one-line why — superseded by the
  // user's next message (the ladder's rule, pinned in contracts).
  it("shows the assistant's set status and note", async () => {
    const { wrapper } = await mountView([
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
    const row = wrapper.findAll(".session-row")[0]!;
    expect(row.find('.session-mark[data-status="completed"]').exists()).toBe(
      true,
    );
    expect(row.text()).toContain("All three drafts are in your inbox.");
  });

  it("expands a continued conversation into its chain with fork percentages", async () => {
    const { wrapper } = await mountView([
      makeEntry({
        sessionId: "sp-2",
        contextTokens: 20_000,
        segments: [
          makeSegment({
            sessionId: "sp-1",
            contextTokens: 166_000,
            isCurrent: false,
          }),
          makeSegment({
            sessionId: "sp-2",
            contextTokens: 20_000,
            continuedFromSessionId: "sp-1",
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

  it("opening a spawned session renders it as a normal chat with a composer, beside the list", async () => {
    const { wrapper, getSessionTranscript } = await mountView([makeEntry()]);

    await openRow(wrapper);

    // The transcript renders through the NORMAL chat path (ThreadStream/
    // MessageRow) — a followed chain reads its chain-spanning transcript.
    expect(getSessionTranscript).toHaveBeenCalledWith("sp-1");
    expect(wrapper.find(".thread-stream").exists()).toBe(true);
    expect(wrapper.text()).toContain("Earlier findings.");
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find(".view-only-note").exists()).toBe(false);
    // The composer says who it speaks to (B8) — the session's persona.
    expect(
      wrapper.get('[data-testid="composer-destination"]').text(),
    ).toContain("Research: pricing");
    // Text-only surface: the attach affordance is gone entirely.
    expect(wrapper.find('[aria-label="Attach files"]').exists()).toBe(false);
    // Two-pane: the list stays put and marks the open row.
    expect(wrapper.get(".session-row").classes()).toContain("is-active");
  });

  // Pipeline scoping rule 3 (Chad, 2026-07-21 evening): a SESSION view is a
  // leaf — no trace/report watch chips, even on rows that would chip on a
  // thread surface (watch chips are gone from ThreadStream entirely).
  it("the opened session's traced rows wear NO watch chip — agent chips only", async () => {
    const { wrapper } = await mountView([makeEntry()], {
      transcriptMessages: [
        {
          id: "m-task",
          body: "Dig into the pricing rules",
          role: "user",
          sourceKind: "global-root",
          partialSessionId: "partial-in",
        },
        {
          id: "m-reply",
          body: "Found three tiers.",
          sourceKind: "workspace-manager",
          sourceLabel: "Research helper",
          partialSessionId: "partial-in",
        },
      ],
    });

    await openRow(wrapper);

    expect(wrapper.text()).toContain("Found three tiers.");
    expect(wrapper.find(".session-link").exists()).toBe(false);
  });

  it("sending posts to the session-turn route, shows queued on the sentinel, then streams", async () => {
    const turnStream = makeStreamHandle();
    const { wrapper, turnCalls } = await mountView([makeEntry()], {
      onTurnRequest: () => turnStream.stream,
    });

    await openRow(wrapper);

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

    // The first real frame clears the queued note; the reply streams through
    // the shared live-turn view (LiveTurn), not a special renderer.
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

  it("a mid-turn send QUEUES (visible chip) and fires after the turn settles — nothing lost", async () => {
    const streams = [makeStreamHandle(), makeStreamHandle()];
    let turnIndex = 0;
    const { wrapper, turnCalls } = await mountView([makeEntry()], {
      onTurnRequest: () => streams[turnIndex++]!.stream,
    });

    await openRow(wrapper);

    const input = wrapper.get("textarea");
    await input.setValue("first question");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(turnCalls).toHaveLength(1);

    // Second send while the first turn streams — queued, not eaten (the
    // composer clears the draft on emit; the host owns the queue).
    await input.setValue("second question");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(turnCalls).toHaveLength(1);
    expect(wrapper.text()).toContain("Queued — sends when this reply finishes");
    expect(wrapper.text()).toContain("second question");

    // The first turn completes → the queue drains in order.
    streams[0]!.push("session-completed", {
      kind: "session-completed",
      sessionId: "sp-1",
    });
    streams[0]!.push("turn-stream-ended", {});
    streams[0]!.close();
    await flushPromises();

    expect(turnCalls).toHaveLength(2);
    expect(turnCalls[1]!.init).toMatchObject({
      body: { userMessageText: "second question" },
    });
    expect(wrapper.text()).not.toContain(
      "Queued — sends when this reply finishes",
    );
  });

  it("a failed transcript read is SAID — a note, not an empty conversation", async () => {
    const { wrapper } = await mountView([makeEntry()], {
      detailError: "Session not found.",
    });

    await openRow(wrapper);

    expect(wrapper.find(".thread-stream").exists()).toBe(false);
    expect(wrapper.get(".state-note.is-error").text()).toContain(
      "Session not found.",
    );
  });

  it("a failed turn keeps the transcript rendered and says the error beside the composer", async () => {
    const turnStream = makeStreamHandle();
    const { wrapper } = await mountView([makeEntry()], {
      onTurnRequest: () => turnStream.stream,
    });

    await openRow(wrapper);

    const input = wrapper.get("textarea");
    await input.setValue("hello");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    // The stream drops mid-turn — the thread must NOT blank.
    turnStream.failWith(new Error("network gone"));
    await flushPromises();

    expect(wrapper.text()).toContain("Earlier findings.");
    expect(wrapper.get(".turn-error-note").text()).toBe("network gone");
  });

  it("a stale-handle 404 reads as 'the session moved', transcript intact", async () => {
    const { wrapper } = await mountView([makeEntry()], {
      turnResponse: { ok: false, status: 404 },
    });

    await openRow(wrapper);

    const input = wrapper.get("textarea");
    await input.setValue("hello");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.text()).toContain("Earlier findings.");
    expect(wrapper.get(".turn-error-note").text()).toBe(
      "This session has moved — go back and reopen it.",
    );
  });

  it("a mid-view chain swap re-points the open thread at the fresh head (B6 — the old accepted freeze)", async () => {
    const entries = [makeEntry()];
    const { wrapper, getSessionTranscript, queryClient } = await mountView(entries);

    await openRow(wrapper);
    expect(getSessionTranscript).toHaveBeenCalledWith("sp-1");
    expect(wrapper.text()).not.toContain("conversation continued");

    // The conversation continues onto a fresh segment (a compaction swap) —
    // the overview's next read reports the new head.
    entries.splice(
      0,
      1,
      makeEntry({
        sessionId: "sp-2",
        contextTokens: 12_000,
        segments: [
          makeSegment({ isCurrent: false, contextTokens: 166_000 }),
          makeSegment({
            sessionId: "sp-2",
            continuedFromSessionId: "sp-1",
            contextTokens: 12_000,
          }),
        ],
      }),
    );
    await queryClient.invalidateQueries();

    // The open pane followed: detail re-keyed onto the head, the quiet note
    // says so, and the composer stays (sends now target sp-2).
    await vi.waitFor(() => expect(getSessionTranscript).toHaveBeenCalledWith("sp-2"));
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain(
        "This conversation continued onto a fresh session",
      ),
    );
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("a superseded chain part opens view-only — no composer, chat continues at the head", async () => {
    const { wrapper } = await mountView([
      makeEntry({
        sessionId: "sp-2",
        segments: [
          makeSegment({ sessionId: "sp-1", isCurrent: false }),
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

  it("a workspace conversation row routes to that room's Chat", async () => {
    const { wrapper, router, pinia } = await mountView(
      [
        makeEntry({
          sessionId: "ws-1",
          scope: "workspace",
          workspaceId: "w1",
          workspaceName: "Marketing",
          title: "Launch plan",
          segments: [makeSegment({ sessionId: "ws-1", title: "Launch plan" })],
        }),
      ],
      { path: "/sessions?workspace=w1" },
    );

    await wrapper.get(".session-row").trigger("click");
    // The target route lazy-loads its view chunk — settle the import first.
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("workspace");
    expect(useUiStore(pinia).activeWorkspaceId).toBe("w1");
  });

  it("invites conversation when there is nothing yet, and hints the empty pane", async () => {
    const { wrapper } = await mountView([]);
    expect(wrapper.text()).toContain("No conversations yet");
    expect(wrapper.text()).toContain("Pick a session");
  });
});

// ── Infinite scroll (2026-08-17) ───────────────────────────────────
// Past 50 conversations the library showed the newest 50 and said nothing
// about the rest — older ones were unreachable from the UI. jsdom has no
// IntersectionObserver, so the sentinel's callback is captured and fired by
// hand: what is under test is the view's reaction to the sentinel coming into
// view, not the browser's scroll detection.
describe("SessionsView — infinite scroll", () => {
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
    const { wrapper } = await mountView(manyEntries(60));

    expect(wrapper.findAll(".session-row")).toHaveLength(50);
    expect(wrapper.find(".sentinel").exists()).toBe(true);

    fireIntersection?.();
    await flushPromises();

    // The whole point: the 10 conversations past the old ceiling are reachable.
    expect(wrapper.findAll(".session-row")).toHaveLength(60);
    expect(wrapper.text()).toContain("Conversation 0");
  });

  it("stops at the last page — a short page ends the scroll", async () => {
    const { wrapper } = await mountView(manyEntries(60));
    fireIntersection?.();
    await flushPromises();
    // 60 rows in, the second page came back short, so there is nothing more to
    // ask for and the sentinel is gone.
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
    const { wrapper } = await mountView(entries);
    fireIntersection?.();
    await flushPromises();

    // The status source is THIS view's pages — the shared overview only ever
    // knows the first 50, so page two would otherwise render unlit.
    expect(wrapper.find('.session-mark[data-status="needs_input"]').exists()).toBe(true);
  });
});
