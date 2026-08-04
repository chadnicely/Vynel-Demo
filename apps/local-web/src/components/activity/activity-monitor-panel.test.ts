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
    /** A SESSION-target trace names its spawned session (the pipeline drill). */
    traceSpawnedTarget?: { sessionId: string; name: string } | null;
    transcriptMessages?: () => TranscriptMessage[];
    transcriptToolCalls?: () => Record<string, unknown[]>;
    onStreamRequest?: () => ReadableStream<Uint8Array>;
    /** The overview the B6 session pane resolves scope/title against —
     *  defaults empty (view-only pane, no composer machinery in the mount). */
    overviewEntries?: () => Array<Record<string, unknown>>;
    /** The B7 roster's poll — in-flight delegations. */
    inFlightDelegations?: () => Array<Record<string, unknown>>;
    /** The B7 roster's durable seed — GET /activity/running. */
    runningTurns?: () => Array<Record<string, unknown>>;
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
    spawnedTargetSession: options.traceSpawnedTarget ?? null,
    entries: options.traceEntries?.() ?? [],
  }));
  const getSession = vi.fn(async (sessionId: string) => ({
    session: { id: sessionId, workspaceId: null },
    messages: (options.transcriptMessages?.() ?? []).map((message) => ({
      id: message.id,
      sessionId,
      role: message.role ?? "assistant",
      sourceKind: null,
      sourceLabel: message.sourceLabel ?? null,
      body: message.body,
    })),
    toolCallsByMessageId: options.transcriptToolCalls?.() ?? {},
  }));
  const overview = vi.fn(async () => options.overviewEntries?.() ?? []);
  const listDelegations = vi.fn(async () => ({
    delegations: options.inFlightDelegations?.() ?? [],
  }));
  const listRunningTurns = vi.fn(async () => ({
    turns: options.runningTurns?.() ?? [],
  }));
  const listWorkspaces = vi.fn(async () => []);
  const stopDelegation = vi.fn(async () => ({}));
  const client = {
    GET,
    root: { getTrace, getSession, stopDelegation, listDelegations },
    sessions: { overview },
    activity: { listRunningTurns },
    workspaces: { list: listWorkspaces },
  } as never;
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

// The B7 Background overview — the panel's base roster node: everything
// running/queued grouped by persona; drills PUSH so Back returns here.
describe("ActivityMonitorPanel — the Background overview", () => {
  it("says so when nothing runs", async () => {
    const harness = makeHarness();
    harness.store.openBackground();
    await vi.waitFor(() =>
      expect(harness.wrapper.get(".viewer-title").text()).toContain(
        "Background activity",
      ),
    );
    expect(harness.wrapper.text()).toContain("Nothing running");
    harness.wrapper.unmount();
  });

  it("groups a working task under its persona; Watch drills to the trace and Back returns to the overview", async () => {
    const harness = makeHarness({
      traceStatus: "claimed",
      traceEntries: () => [
        {
          id: "t-user",
          role: "user",
          sourceKind: "global-root",
          sourceLabel: null,
          body: "Research WAL mode",
          toolCalls: [],
        },
      ],
      inFlightDelegations: () => [
        {
          partialSessionId: "trace-1",
          workspaceId: null,
          workspaceName: "Nova",
          targetPrimarySessionId: "primary-1",
          sessionName: "Nova",
          taskLabel: "Research WAL mode",
          status: "claimed",
        },
      ],
    });
    harness.store.openBackground();

    await vi.waitFor(() =>
      expect(
        harness.wrapper.find('[data-testid="background-group"]').exists(),
      ).toBe(true),
    );
    const group = harness.wrapper.get('[data-testid="background-group"]');
    expect(group.text()).toContain("Nova");
    expect(group.text()).toContain("Research WAL mode");
    expect(group.text()).toContain("Working");

    await harness.wrapper
      .get('[data-testid="background-task-watch"]')
      .trigger("click");
    await flushPromises();
    // The trace node stacked on top — its own view, Back names the roster.
    await vi.waitFor(() =>
      expect(harness.wrapper.get(".status-pill").text()).toBe("Working…"),
    );
    expect(harness.getTrace).toHaveBeenCalledWith("trace-1");

    await harness.wrapper
      .get('[aria-label="Back to the overview"]')
      .trigger("click");
    await flushPromises();
    expect(harness.wrapper.get(".viewer-title").text()).toContain(
      "Background activity",
    );
    expect(
      harness.wrapper.find('[data-testid="background-group"]').exists(),
    ).toBe(true);
    harness.wrapper.unmount();
  });

  it("a fresh window rebuilds from the durable seed — a running turn shows before any stream frame", async () => {
    const harness = makeHarness({
      runningTurns: () => [
        {
          turnId: "turn-durable",
          scopeKind: "global",
          workspaceId: null,
          origin: "schedule",
          sessionId: "sdk-1",
          primarySessionId: null,
          jobId: null,
          threadId: null,
          partialSessionId: null,
          startedAt: "2026-08-04T10:00:00.000Z",
        },
      ],
    });
    harness.store.openBackground();
    await vi.waitFor(() =>
      expect(
        harness.wrapper.find('[data-testid="background-group"]').exists(),
      ).toBe(true),
    );
    const group = harness.wrapper.get('[data-testid="background-group"]');
    // No delegation, no feed frame — identity falls to the assistant, the
    // origin note says where it fired from.
    expect(group.text()).toContain("Assistant");
    expect(group.text()).toContain("from a schedule");
    expect(group.text()).toContain("Working");
    harness.wrapper.unmount();
  });

  it("Stop on a task row stops that delegation without leaving the roster", async () => {
    const harness = makeHarness({
      inFlightDelegations: () => [
        {
          partialSessionId: "trace-1",
          workspaceId: null,
          workspaceName: "Nova",
          targetPrimarySessionId: "primary-1",
          sessionName: "Nova",
          taskLabel: "Research WAL mode",
          status: "pending",
        },
      ],
    });
    harness.store.openBackground();
    await vi.waitFor(() =>
      expect(
        harness.wrapper.find('[data-testid="background-task-stop"]').exists(),
      ).toBe(true),
    );
    await harness.wrapper
      .get('[data-testid="background-task-stop"]')
      .trigger("click");
    await vi.waitFor(() =>
      expect(harness.stopDelegation).toHaveBeenCalledWith("trace-1"),
    );
    expect(harness.wrapper.get(".viewer-title").text()).toContain(
      "Background activity",
    );
    harness.wrapper.unmount();
  });
});

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
    // test: correct expectation (B6) — the entries list's "Watching live"
    // empty-state left with the list; the header's context line carries the
    // watching promise for the session pane.
    expect(harness.wrapper.text()).toContain("Watching this conversation live");
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
    // test: correct expectation (B6) — a session node's body is the REAL
    // thread now (LiveSessionPane): the streamed text renders through the
    // live-turn overlay; the entries list's "Still working…" line died with
    // the list for session nodes.
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("Working on it"),
    );

    persisted = [{ id: "m1", body: "Working on it" }];
    handle.push("turn-stream-ended", {});
    handle.close();
    // The watch is STANDING (B3): after settle the pane swaps the overlay for
    // the settled transcript row (its own settle refetch) and the stream
    // re-attaches for the session's next turn.
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("Working on it"),
    );
    await vi.waitFor(() => expect(harness.GET.mock.calls.length).toBeGreaterThan(1));
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
    // test: correct expectation (B6) — the session pane says the drop with
    // its own quiet note (the registry keeps retrying); the entries list's
    // error surface left with the list.
    await vi.waitFor(() =>
      expect(
        harness.wrapper.find('[data-testid="live-drop-note"]').exists(),
      ).toBe(true),
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

// The watch-pipeline drill (Chad's 2026-07-21 scoping rules): from a trace
// node, a session-report entry drills into the spawned session's node —
// Trace → Session → Agent, Back walking up.
describe("ActivityMonitorPanel — the pipeline drill (trace → session)", () => {
  const sessionTraceEntries = () => [
    {
      id: "t-user",
      role: "user",
      sourceKind: "global-root",
      sourceLabel: null,
      body: "Dig into the pricing rules",
      toolCalls: [],
    },
    {
      id: "t-report",
      role: "assistant",
      sourceKind: "workspace-manager",
      sourceLabel: "Research helper",
      body: "Found three pricing tiers.",
      toolCalls: [],
    },
  ];

  it("a session-target trace's report entry drills into the session node; Back returns to the task", async () => {
    const harness = makeHarness({
      traceStatus: "completed",
      traceEntries: sessionTraceEntries,
      traceSpawnedTarget: { sessionId: "sdk-spawned", name: "Research helper" },
      transcriptMessages: () => [
        { id: "m-s1", body: "the session's own reply" },
      ],
    });
    harness.store.openTrace("trace-1");
    await vi.waitFor(() =>
      expect(harness.wrapper.find(".session-drill").exists()).toBe(true),
    );
    // The chip sits on the SESSION's attributed entry, named after it.
    expect(harness.wrapper.get(".session-drill").text()).toContain(
      "Research helper",
    );

    await harness.wrapper.get(".session-drill").trigger("click");
    await flushPromises();
    // The panel re-bound to the SESSION node: its title, its channel, and the
    // trace-only job pill gone.
    expect(harness.wrapper.get(".viewer-title").text()).toContain(
      "Research helper",
    );
    await vi.waitFor(() =>
      expect(
        harness.GET.mock.calls.some(
          (call) => call[0] === "/sessions/{sessionId}/stream",
        ),
      ).toBe(true),
    );
    expect(harness.wrapper.find(".status-pill").exists()).toBe(false);
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("the session's own reply"),
    );

    // Back pops the session node — the trace view returns.
    await harness.wrapper.get('[aria-label="Back to the task"]').trigger("click");
    await flushPromises();
    expect(harness.wrapper.text()).toContain("Dig into the pricing rules");
    expect(harness.wrapper.get(".status-pill").text()).toBe("Done");
    harness.wrapper.unmount();
  });

  it("a WORKSPACE-target trace offers no session drill", async () => {
    // spawnedTargetSession is null for workspace targets — the drill is a
    // session-report affordance only.
    const harness = makeHarness({
      traceStatus: "completed",
      traceEntries: sessionTraceEntries,
      traceSpawnedTarget: null,
    });
    harness.store.openTrace("trace-1");
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("Found three pricing tiers."),
    );
    expect(harness.wrapper.find(".session-drill").exists()).toBe(false);
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
    harness.store.openAgentDirect({ kind: "trace", id: "trace-1" }, "tu_agent_1");

    await vi.waitFor(() =>
      expect(harness.wrapper.find(".agent-focus").exists()).toBe(true),
    );
    expect(harness.wrapper.find('[aria-label="Back to the task"]').exists()).toBe(
      false,
    );
    expect(harness.wrapper.find('[aria-label="Close"]').exists()).toBe(true);
    harness.wrapper.unmount();
  });

  it("openAgentDirect over a SESSION source: a settled DIRECT-turn agent renders its recorded activity + report", async () => {
    // No trace exists for a direct turn — the agent's data is the session
    // transcript's persisted subagent fields (Slice ④ coverage).
    const harness = makeHarness({
      transcriptMessages: () => [{ id: "m-1", body: "spawning a scout" }],
      transcriptToolCalls: () => ({ "m-1": [makeAgentToolCall()] }),
    });
    harness.store.openAgentDirect({ kind: "session", id: "s1" }, "tu_agent_1");

    await vi.waitFor(() =>
      expect(harness.wrapper.find(".agent-focus").exists()).toBe(true),
    );
    // The monitor bound to the SESSION channel, not a trace read.
    expect(harness.GET.mock.calls[0]![0]).toBe("/sessions/{sessionId}/stream");
    expect(harness.getTrace).not.toHaveBeenCalled();
    expect(harness.wrapper.get(".viewer-title").text()).toContain("Agent scout");
    expect(harness.wrapper.get(".agent-activity").text()).toContain(
      "Scanned the docs folder.",
    );
    expect(harness.wrapper.get(".agent-report").text()).toContain(
      "The pricing rules live in pricing.md",
    );
    // Direct open: Close only, no Back.
    expect(
      harness.wrapper.find('[aria-label="Back to the conversation"]').exists(),
    ).toBe(false);
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
