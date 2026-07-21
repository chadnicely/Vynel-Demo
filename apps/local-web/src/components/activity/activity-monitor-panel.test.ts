// The merged activity panel (sessions-surface Slice ②) — carries the UNION of
// the retired SessionWatchPanel + SessionViewerPanel test intents: session
// watch states (live fold, settle, history-on-open, drop, Close), the trace
// job affordances (status pill, Stop, echo collapse), and the node-stack agent
// drill-down (focusAgent → Back; openAgentDirect → Close only; live map wins
// over the persisted settled fallback), from BOTH source kinds.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityMonitorStore } from "../../stores/activity-monitor-store.js";
import ActivityMonitorPanel from "./ActivityMonitorPanel.vue";

function sseFrame(kind: string, payload: object): Uint8Array {
  return new TextEncoder().encode(
    `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

/** A controllable observe stream: the test pushes frames / errors / closes. */
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
    fail: (message: string) => controller.error(new Error(message)),
    close: () => controller.close(),
  };
}

/** A spawning Agent call's row, settled with persisted subagent fields. */
function makeAgentToolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "tc-1",
    toolUseId: "tu_agent_1",
    parentMessageId: "m-1",
    toolName: "Agent",
    toolInput: { name: "scout", description: "Find the pricing rules" },
    toolOutput: "The pricing rules live in pricing.md",
    status: "completed",
    isErrorResult: false,
    startedAt: "2026-07-21T10:00:00.000Z",
    completedAt: "2026-07-21T10:01:00.000Z",
    subagentNarrative: "Scanned the docs folder.",
    subagentToolCalls: [
      {
        toolUseId: "tu_sub_1",
        toolName: "Read",
        toolInput: { file_path: "pricing.md" },
        status: "completed",
      },
    ],
    ...overrides,
  };
}

interface TranscriptMessage {
  id: string;
  body: string;
  role?: string;
  sourceLabel?: string | null;
}

function makeHarness(
  options: {
    traceStatus?: string;
    traceEntries?: () => Array<Record<string, unknown>>;
    transcriptMessages?: () => TranscriptMessage[];
    transcriptToolCalls?: () => Record<string, unknown[]>;
    onStreamRequest?: () => ReadableStream<Uint8Array>;
  } = {},
) {
  const streamSignals: AbortSignal[] = [];
  const GET = vi.fn(async (_path: string, init: { signal: AbortSignal }) => {
    streamSignals.push(init.signal);
    const stream = options.onStreamRequest?.() ?? makeStreamHandle().stream;
    return { data: stream, response: { ok: true, status: 200 } };
  });
  const getTrace = vi.fn(async (partialSessionId: string) => ({
    partialSessionId,
    status: options.traceStatus ?? "claimed",
    entries: options.traceEntries?.() ?? [],
  }));
  const getSession = vi.fn(async () => ({
    session: { id: "s1" },
    messages: (options.transcriptMessages?.() ?? []).map((message) => ({
      id: message.id,
      role: message.role ?? "assistant",
      sourceKind: null,
      sourceLabel: message.sourceLabel ?? null,
      body: message.body,
    })),
    toolCallsByMessageId: options.transcriptToolCalls?.() ?? {},
  }));
  const stopDelegation = vi.fn(async () => ({}));
  const client = { GET, root: { getTrace, getSession, stopDelegation } } as never;
  const pinia = createPinia();
  const wrapper = mount(ActivityMonitorPanel, {
    global: {
      stubs: { teleport: true },
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
  return {
    wrapper,
    pinia,
    GET,
    getTrace,
    getSession,
    stopDelegation,
    streamSignals,
    store: useActivityMonitorStore(pinia),
  };
}

describe("ActivityMonitorPanel — session nodes", () => {
  it("stays hidden until a session is watched, then attaches to ITS stream", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({ onStreamRequest: () => handle.stream });
    expect(harness.wrapper.find(".session-viewer").exists()).toBe(false);

    harness.store.openSession("s1", "Assistant · Ongoing conversation");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    expect(harness.GET.mock.calls[0]![0]).toBe("/sessions/{sessionId}/stream");
    expect(harness.GET.mock.calls[0]![1]).toMatchObject({
      params: { path: { sessionId: "s1" } },
      parseAs: "stream",
    });

    await flushPromises();
    expect(harness.wrapper.get(".viewer-title").text()).toContain(
      "Assistant · Ongoing conversation",
    );
    expect(harness.wrapper.text()).toContain("Watching live");
    harness.wrapper.unmount();
  });

  it("folds live events into entries and settles on turn-stream-ended", async () => {
    const handle = makeStreamHandle();
    // The persisted copy advances as the turn streams (server reality) — at
    // settle the monitor swaps the overlay for THIS.
    let persisted: TranscriptMessage[] = [];
    const harness = makeHarness({
      onStreamRequest: () => handle.stream,
      transcriptMessages: () => persisted,
    });
    harness.store.openSession("s1", "Assistant");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "Working on it",
    });
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("Working on it"),
    );
    expect(harness.wrapper.text()).toContain("Still working…");

    persisted = [{ id: "m1", body: "Working on it" }];
    handle.push("turn-stream-ended", {});
    handle.close();
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("you're all caught up"),
    );
    // The activity stays on screen after the turn ends — now as the SETTLED
    // transcript row (the monitor's settle refetch replaced the overlay).
    expect(harness.wrapper.text()).toContain("Working on it");
    harness.wrapper.unmount();
  });

  it("opens onto the session's history — the settled transcript renders with no live turn", async () => {
    const harness = makeHarness({
      transcriptMessages: () => [{ id: "m-old", body: "an earlier answer" }],
    });
    harness.store.openSession("s1", "Assistant");
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("an earlier answer"),
    );
    harness.wrapper.unmount();
  });

  it("says so when the stream drops instead of swallowing the failure", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({ onStreamRequest: () => handle.stream });
    harness.store.openSession("s1", "Assistant");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.fail("network died");
    await vi.waitFor(() =>
      expect(harness.wrapper.find(".state-note.is-error").exists()).toBe(true),
    );
    harness.wrapper.unmount();
  });

  it("Close detaches the stream and clears the store", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({ onStreamRequest: () => handle.stream });
    harness.store.openSession("s1", "Assistant");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    await flushPromises();

    await harness.wrapper.get('[aria-label="Close"]').trigger("click");
    await flushPromises();

    expect(harness.store.isOpen).toBe(false);
    expect(harness.streamSignals[0]!.aborted).toBe(true);
    harness.wrapper.unmount();
  });

  it("drills into an agent FROM a session node — Back returns to the conversation", async () => {
    const harness = makeHarness({
      transcriptMessages: () => [{ id: "m-1", body: "spawning an agent" }],
      transcriptToolCalls: () => ({ "m-1": [makeAgentToolCall()] }),
    });
    harness.store.openSession("s1", "Assistant");
    await vi.waitFor(() =>
      expect(harness.wrapper.find(".watch-chip").exists()).toBe(true),
    );

    await harness.wrapper.get(".watch-chip").trigger("click");
    await flushPromises();
    expect(harness.wrapper.get(".viewer-title").text()).toContain("Agent scout");
    expect(harness.wrapper.find(".agent-activity").exists()).toBe(true);

    await harness.wrapper
      .get('[aria-label="Back to the conversation"]')
      .trigger("click");
    await flushPromises();
    expect(harness.wrapper.find(".agent-focus").exists()).toBe(false);
    expect(harness.wrapper.text()).toContain("spawning an agent");
    harness.wrapper.unmount();
  });
});

describe("ActivityMonitorPanel — trace nodes", () => {
  const traceEntries = () => [
    {
      id: "t-user",
      role: "user",
      sourceKind: "global-root",
      sourceLabel: null,
      body: "Set up the login page",
      toolCalls: [],
    },
    {
      id: "t-reply",
      role: "assistant",
      sourceKind: "workspace",
      sourceLabel: "Noah · vynel",
      body: "Done — the login page is live.",
      toolCalls: [],
    },
    // The surfaced global report carries the SAME body — display collapses it.
    {
      id: "t-echo",
      role: "assistant",
      sourceKind: null,
      sourceLabel: null,
      body: "Done — the login page is live.",
      toolCalls: [],
    },
  ];

  it("wears the job status pill, titles by the workspace label, and collapses the report echo", async () => {
    const harness = makeHarness({ traceStatus: "claimed", traceEntries });
    harness.store.openTrace("trace-1");

    await vi.waitFor(() =>
      expect(harness.wrapper.get(".status-pill").text()).toBe("Working…"),
    );
    expect(harness.wrapper.get(".viewer-title").text()).toContain("Noah · vynel");
    // The trace attached its own observe stream, not the session channel.
    expect(harness.GET.mock.calls[0]![0]).toBe(
      "/root/trace/{partialSessionId}/stream",
    );
    // Task + reply — the echoed report row is hidden.
    expect(harness.wrapper.findAll(".entry")).toHaveLength(2);
    expect(harness.wrapper.get(".entry.is-task").text()).toContain(
      "Set up the login page",
    );
    harness.wrapper.unmount();
  });

  it("Stop stops THIS task while it runs", async () => {
    const harness = makeHarness({ traceStatus: "claimed", traceEntries });
    harness.store.openTrace("trace-1");
    await vi.waitFor(() =>
      expect(harness.wrapper.find('[aria-label="Stop this task"]').exists()).toBe(
        true,
      ),
    );

    await harness.wrapper.get('[aria-label="Stop this task"]').trigger("click");
    await vi.waitFor(() =>
      expect(harness.stopDelegation).toHaveBeenCalledWith("trace-1"),
    );
    harness.wrapper.unmount();
  });

  it("a settled trace shows Done with no Stop", async () => {
    const harness = makeHarness({ traceStatus: "completed", traceEntries });
    harness.store.openTrace("trace-1");

    await vi.waitFor(() =>
      expect(harness.wrapper.get(".status-pill").text()).toBe("Done"),
    );
    expect(harness.wrapper.find('[aria-label="Stop this task"]').exists()).toBe(
      false,
    );
    harness.wrapper.unmount();
  });
});

describe("ActivityMonitorPanel — agent drill-down", () => {
  const agentTraceEntries = () => [
    {
      id: "t-spawn",
      role: "assistant",
      sourceKind: "workspace",
      sourceLabel: "Noah · vynel",
      body: "Spawning a scout.",
      toolCalls: [makeAgentToolCall()],
    },
  ];

  it("focusAgent from an open trace: settled fallback renders the persisted activity + report; Back returns", async () => {
    const harness = makeHarness({
      traceStatus: "completed",
      traceEntries: agentTraceEntries,
    });
    harness.store.openTrace("trace-1");
    await vi.waitFor(() =>
      expect(harness.wrapper.find(".watch-chip").exists()).toBe(true),
    );

    await harness.wrapper.get(".watch-chip").trigger("click");
    await flushPromises();
    expect(harness.wrapper.get(".viewer-title").text()).toContain("Agent scout");
    // Settled fallback: the persisted subagent fields drive the pane...
    expect(harness.wrapper.get(".agent-activity").text()).toContain(
      "Scanned the docs folder.",
    );
    // ...and the final report is the settled call's output.
    expect(harness.wrapper.get(".agent-report").text()).toContain(
      "The pricing rules live in pricing.md",
    );
    // The agent view hides the trace-only job pill.
    expect(harness.wrapper.find(".status-pill").exists()).toBe(false);

    await harness.wrapper.get('[aria-label="Back to the task"]').trigger("click");
    await flushPromises();
    expect(harness.wrapper.find(".agent-focus").exists()).toBe(false);
    expect(harness.wrapper.text()).toContain("Spawning a scout.");
    harness.wrapper.unmount();
  });

  it("openAgentDirect lands on the agent with Close only — no Back", async () => {
    const harness = makeHarness({
      traceStatus: "completed",
      traceEntries: agentTraceEntries,
    });
    harness.store.openAgentDirect("trace-1", "tu_agent_1");

    await vi.waitFor(() =>
      expect(harness.wrapper.find(".agent-focus").exists()).toBe(true),
    );
    expect(harness.wrapper.find('[aria-label="Back to the task"]').exists()).toBe(
      false,
    );
    expect(harness.wrapper.find('[aria-label="Close"]').exists()).toBe(true);
    harness.wrapper.unmount();
  });

  it("a RUNNING agent's live activity wins over the settled fallback", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({
      traceStatus: "claimed",
      traceEntries: () => [
        {
          id: "t-spawn",
          role: "assistant",
          sourceKind: null,
          sourceLabel: "Noah · vynel",
          body: "",
          toolCalls: [
            makeAgentToolCall({
              status: "started",
              toolOutput: null,
              completedAt: null,
              subagentNarrative: null,
              subagentToolCalls: null,
            }),
          ],
        },
      ],
      onStreamRequest: () => handle.stream,
    });
    harness.store.openTrace("trace-1");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.push("agent-text-chunk", {
      kind: "agent-text-chunk",
      parentToolUseId: "tu_agent_1",
      textDelta: "Scanning the repo for pricing rules.",
    });
    await flushPromises();

    harness.store.focusAgent("tu_agent_1");
    await vi.waitFor(() =>
      expect(harness.wrapper.get(".agent-activity").text()).toContain(
        "Scanning the repo for pricing rules.",
      ),
    );
    harness.wrapper.unmount();
  });
});
