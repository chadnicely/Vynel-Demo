// The routed session pane (sessions-surface Slice ③b; the library moved into
// the sidebar 2026-08-24 — `sessions-sidebar.test.ts` pins the list). This
// file pins the PANE: which conversation the route opens (`?session=` follows
// the chain head, `&part=` opens a superseded part view-only, a primary never
// arrives here), the selected session rendered as a NORMAL chat
// (ThreadStream), the session-turn composer (queued sentinel, error notes),
// and the B6 follow across a mid-view chain swap.

import { describe, expect, it, vi } from "vitest";
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
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
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
    icon: null,
    model: "claude-opus-4-8",
    contextTokens: 40_000,
    contextWindow: 200_000,
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    // Quiet by default (Move 3): no set state, no error, nothing pending —
    // these fixtures exercise the pane, not the status ladder.
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
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]> = {},
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
    toolCallsByMessageId,
  };
}

/** A call the provider's own safety check refused — the classifier-deny card. */
const blockedCall: ChatToolCallResponse = {
  id: "tc-blocked",
  parentMessageId: "m-1",
  toolUseId: "tu-blocked",
  toolName: "Bash",
  toolInput: { command: 'ssh ops@host "crontab -"' },
  toolOutput: {
    blockedBy: "classifier",
    reason: "Writing a remote crontab is irreversible without clear user intent",
    message: "The user doesn't want to take this action right now.",
  },
  status: "blocked",
  approvalStatus: null,
  isErrorResult: true,
  startedAt: "2026-07-21T09:00:00.000Z",
  completedAt: "2026-07-21T09:00:01.000Z",
};

/** The route that opens a conversation — what a sidebar row click pushes. */
const OPEN_SP1 = "/sessions?session=sp-1";

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
    /** Tool calls under the transcript rows (keyed by message id). */
    transcriptToolCalls?: Record<string, ChatToolCallResponse[]>;
  } = {},
) {
  // A followed chain reads the chain-spanning transcript; a deliberately
  // opened earlier part reads its own segment — both serve the same envelope.
  const getSessionTranscript = vi.fn(async () => {
    if (options.detailError !== undefined)
      throw new Error(options.detailError);
    return makeTranscript(
      options.transcriptMessages ?? [{ id: "m-1", body: "Earlier findings." }],
      options.transcriptToolCalls,
    );
  });
  const getSession = vi.fn(async () => {
    if (options.detailError !== undefined)
      throw new Error(options.detailError);
    return makeTranscript(
      options.transcriptMessages ?? [{ id: "m-1", body: "Earlier findings." }],
      options.transcriptToolCalls,
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
    // Fresh payload per read (like the route): handing back the caller's
    // array by reference would defeat structural sharing when a test mutates
    // it to simulate a server-side change.
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

describe("SessionsView", () => {
  it("a spawned session named on the route renders as a normal chat with a composer", async () => {
    const { wrapper, getSessionTranscript } = await mountView([makeEntry()], {
      path: OPEN_SP1,
    });

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
  });

  it("a deep link the library has not paged in still opens — the route is the truth", async () => {
    const { wrapper, getSessionTranscript } = await mountView([], {
      path: "/sessions?session=sp-9",
    });
    expect(getSessionTranscript).toHaveBeenCalledWith("sp-9");
    expect(wrapper.find(".thread-stream").exists()).toBe(true);
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  // Pipeline scoping rule 3 (Chad, 2026-07-21 evening): a SESSION view is a
  // leaf — no trace/report watch chips, even on rows that would chip on a
  // thread surface (watch chips are gone from ThreadStream entirely).
  it("the opened session's traced rows wear NO watch chip — agent chips only", async () => {
    const { wrapper } = await mountView([makeEntry()], {
      path: OPEN_SP1,
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

    expect(wrapper.text()).toContain("Found three tiers.");
    expect(wrapper.find(".session-link").exists()).toBe(false);
  });

  it("sending posts to the session-turn route, shows queued on the sentinel, then streams", async () => {
    const turnStream = makeStreamHandle();
    const { wrapper, turnCalls } = await mountView([makeEntry()], {
      path: OPEN_SP1,
      onTurnRequest: () => turnStream.stream,
    });

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

  // The classifier-deny card end to end on an owner: the thread relays the
  // card's "Run it anyway", the OWNER sends it through its own composer — the
  // same session-turn route a typed message takes, carrying the explicit
  // approval that names the tool.
  it("Run it anyway on a BLOCKED tool card sends the explicit approval as a normal turn on the same session", async () => {
    const { wrapper, turnCalls } = await mountView([makeEntry()], {
      path: OPEN_SP1,
      transcriptMessages: [{ id: "m-1", body: "Setting the cron up." }],
      transcriptToolCalls: { "m-1": [blockedCall] },
    });

    const line = wrapper.get('[data-testid="tool-call-blocked"]');
    expect(line.text()).toContain("Blocked by Claude's safety check");
    expect(line.text()).toContain("irreversible without clear user intent");

    await line.get(".reauthorize-button").trigger("click");
    await flushPromises();

    expect(turnCalls).toHaveLength(1);
    expect(turnCalls[0]!.path).toBe("/sessions/{sessionId}/turn");
    expect(turnCalls[0]!.init).toMatchObject({
      params: { path: { sessionId: "sp-1" } },
      body: { userMessageText: "Approved — go ahead and run Bash exactly as proposed." },
      parseAs: "stream",
    });
    // One click, one message — the button is spent.
    expect(wrapper.find(".reauthorize-button").exists()).toBe(false);
  });

  // A view-only open (no composer) has nowhere to send the re-issue: the card
  // still tells the story, but the button is disabled and says so — and a
  // click must never reach the turn route.
  it("a view-only open offers Run it anyway disabled with the view-only title — a click sends nothing", async () => {
    const { wrapper, turnCalls } = await mountView(
      [
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
      ],
      {
        // The superseded part, by `part` — what a chain-node click pushes.
        path: "/sessions?session=sp-2&part=sp-1",
        transcriptMessages: [{ id: "m-1", body: "Setting the cron up." }],
        transcriptToolCalls: { "m-1": [blockedCall] },
      },
    );

    expect(wrapper.find("textarea").exists()).toBe(false);

    const button = wrapper.get('[data-testid="tool-call-blocked"] .reauthorize-button');
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toContain("view-only");

    await button.trigger("click");
    await flushPromises();

    expect(turnCalls).toHaveLength(0);
    // Not spent either — nothing was sent.
    expect(wrapper.find(".reauthorize-button").exists()).toBe(true);
  });

  it("a mid-turn send QUEUES (visible chip) and fires after the turn settles — nothing lost", async () => {
    const streams = [makeStreamHandle(), makeStreamHandle()];
    let turnIndex = 0;
    const { wrapper, turnCalls } = await mountView([makeEntry()], {
      path: OPEN_SP1,
      onTurnRequest: () => streams[turnIndex++]!.stream,
    });

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
      path: OPEN_SP1,
      detailError: "Session not found.",
    });

    expect(wrapper.find(".thread-stream").exists()).toBe(false);
    expect(wrapper.get(".state-note.is-error").text()).toContain(
      "Session not found.",
    );
  });

  it("a failed turn keeps the transcript rendered and says the error beside the composer", async () => {
    const turnStream = makeStreamHandle();
    const { wrapper } = await mountView([makeEntry()], {
      path: OPEN_SP1,
      onTurnRequest: () => turnStream.stream,
    });

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
      path: OPEN_SP1,
      turnResponse: { ok: false, status: 404 },
    });

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
    const { wrapper, getSessionTranscript, queryClient } = await mountView(entries, {
      path: OPEN_SP1,
    });

    expect(getSessionTranscript).toHaveBeenCalledWith("sp-1");
    expect(wrapper.text()).not.toContain("conversation continued");

    // The conversation continues onto a fresh segment (a compaction swap) —
    // the overview's next read reports the new head. The route still names
    // sp-1: the pane follows from there rather than remounting on sp-2.
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
    const { wrapper } = await mountView(
      [
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
      ],
      { path: "/sessions?session=sp-2&part=sp-1" },
    );

    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.get(".view-only-note").text()).toContain(
      "chat carries on at the newest part",
    );
  });

  it("hints the empty pane when nothing is open", async () => {
    const { wrapper } = await mountView([]);
    expect(wrapper.text()).toContain("Pick a session");
    expect(wrapper.find(".thread-stream").exists()).toBe(false);
  });
});
