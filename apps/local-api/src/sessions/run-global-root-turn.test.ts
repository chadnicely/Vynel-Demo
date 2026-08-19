// Unit test for the global-root turn wrapper. The shared core
// (`runGlobalRootTurnCore`) is mocked so we drive the DRAIN sink directly and
// assert its contract: accumulate text chunks, capture the session id, and throw
// (via `requireResult`) when the turn produced no session or captured an in-stream
// error. `@vynel/mcp` is stubbed so the REAL composer runs with a `build → null`
// routing descriptor — the phase-now routing-toolless global root (empty MCP set) —
// without pulling the SDK. The wall-clock cases (BT4) run the REAL clock helpers
// over fake timers with the chat boundary (failure row + interrupt) mocked; the
// lock-release half lives in `run-global-root-turn.wall-clock.test.ts` against
// the real core + a real database.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database } from "@vynel/db";
import type { Logger } from "pino";
import type { SessionActivityFeed, SessionSink } from "@vynel/session/runtime";

const {
  coreMock,
  resolveTargetMock,
  chatSessionRowMock,
  persistTurnFailureRowMock,
  interruptChatSessionMock,
  buildAskFeatureDescriptorMock,
} = vi.hoisted(() => ({
  coreMock: vi.fn(),
  resolveTargetMock: vi.fn(),
  chatSessionRowMock: vi.fn(),
  persistTurnFailureRowMock: vi.fn(),
  interruptChatSessionMock: vi.fn(),
  buildAskFeatureDescriptorMock: vi.fn(),
}));

vi.mock("@vynel/session/runtime", async () => {
  // The REAL step mapper runs (it's pure) so the drain sink's feed-narration
  // tap is exercised, while the heavy core stays mocked.
  const actual = await vi.importActual<typeof import("@vynel/session/runtime")>(
    "@vynel/session/runtime",
  );
  return {
    runGlobalRootTurnCore: coreMock,
    publishTurnActivityStep: actual.publishTurnActivityStep,
    // The REAL fit guard too (pure over the mocked row read) — the D1 tests
    // assert its clamp.
    fitPinnedModelToSession: actual.fitPinnedModelToSession,
    // The REAL wall clock (BT4) — timers + the gate are pure; its chat
    // boundary (the failure row, the interrupt) is mocked below.
    startTurnWallClock: actual.startTurnWallClock,
    trackApprovalParks: actual.trackApprovalParks,
    failTurnOnWallClock: actual.failTurnOnWallClock,
  };
});
// The wall clock's expiry writes through `@vynel/chat`: the failure row (a
// real db elsewhere — these tests drive the stub `{}` one) + the provider
// interrupt, which here RELEASES the hung core stub the way the SDK ends an
// interrupted session.
vi.mock("@vynel/chat", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  persistTurnFailureRow: persistTurnFailureRowMock,
  interruptChatSession: interruptChatSessionMock,
}));
// The ask descriptor, recorded — the gate assertion (a parked ask suspends
// the clock) reads what the runner handed it; a null build keeps the SDK out.
vi.mock("@vynel/asks/mcp", () => ({
  buildAskFeatureDescriptor: buildAskFeatureDescriptorMock,
}));

// Stub routing descriptor: `build` returns null → the real `composeSessionMcpServers`
// yields an empty MCP set, and the heavy `@vynel/mcp` (SDK builder) never loads.
vi.mock("@vynel/mcp", () => ({
  vynelRoutingDescriptor: { serverName: "vynel", build: () => null },
}));
// The runner resolves admin tool overrides per turn against the real db —
// these tests drive a stub `{}` db, so the resolver answers "no overrides".
vi.mock("@vynel/capabilities", () => ({
  defaultEnabledCapabilityIds: () => new Set<string>(),
  resolveEffectiveToolPolicies: () => new Map(),
  // The baked layer passes the catalog through untouched here — no map is
  // primed in tests.
  applyToolPolicyDefaultsToCatalog: (catalog: unknown) => catalog,
}));
// Same treatment for the notebook descriptor (instructions slice) — a null
// build keeps the SDK out and the composed MCP set empty.
vi.mock("@vynel/instructions", () => ({
  notebookFeatureDescriptor: {
    serverName: "vynel-notebook",
    build: () => null,
  },
}));
// Same treatment for whoami (continuity arc Slice 3) — a null build keeps the
// composed set empty for these drain-sink tests.
vi.mock("@vynel/session/mcp", () => ({
  buildSessionFeatureDescriptor: () => ({
    serverName: "vynel-session",
    build: () => null,
    mutatingToolNames: [],
  }),
}));
// The runner composes user-scope agents against the real db — these tests
// drive a stub `{}` db, so the composition (and its lifecycle records, which
// only fire when agents exist) is stubbed empty.
vi.mock("@vynel/orchestration", async () => {
  const actual = await vi.importActual<typeof import("@vynel/orchestration")>(
    "@vynel/orchestration",
  );
  return { ...actual, composeSessionAgents: async () => ({}) };
});
// The runner now resolves the root's stable primary BEFORE composing (the
// desktop action record keys rows by it) — real resolution needs a real db,
// and these tests drive the stub `{}` one. The resolver itself is covered by
// `get-or-create-primary-session.test.ts`. Per-test overridable (the D1
// settings tests point it at a head segment).
vi.mock("./resolve-global-root-conversation.js", () => ({
  resolveGlobalRootConversationTarget: resolveTargetMock,
}));
// The global row's settings read (session-hardening D1: the channel runner
// resolves the row's mode/model/effort/autopilot) — stubbed per test.
vi.mock("@vynel/chat/repositories", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findChatSessionById: chatSessionRowMock,
}));

import {
  runGlobalRootTurn,
  wrapAppRequestWithOrigin,
  buildGlobalRootReportTurnRunner,
  TurnWallClockExceededError,
} from "./run-global-root-turn.js";
import { REPORT_DELIVERY_INSTRUCTIONS } from "@vynel/session/delegation";
import {
  DELEGATION_ORIGIN_HEADER,
  serializeDelegationOrigin,
} from "./delegation-origin-header.js";
import type { RunGlobalRootTurnCoreDeps } from "@vynel/session/runtime";
import type { PendingAskRegistry } from "@vynel/asks";

type SinkEvent = Parameters<SessionSink["onEvent"]>[0];

// `@vynel/session/runtime` is mocked above, so the real feed class is
// unavailable — a recording fake stands in (and lets tests assert the
// begin/end announcement wiring).
function fakeActivityFeed() {
  const handle = {
    turnId: "turn-1",
    sessionResolved: vi.fn(),
    publishTurnStep: vi.fn(),
    end: vi.fn(),
  };
  const begin = vi.fn(() => handle);
  return { feed: { begin } as unknown as SessionActivityFeed, begin, handle };
}

function fakeDeps(activityFeed: SessionActivityFeed = fakeActivityFeed().feed) {
  return {
    db: {} as unknown as Database,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger,
    appRequest: vi.fn(),
    activityFeed,
  };
}

beforeEach(() => {
  coreMock.mockReset();
  resolveTargetMock.mockReset();
  resolveTargetMock.mockResolvedValue({
    primarySessionId: "root-primary-1",
    resumeSdkSessionId: null,
    workspacePath: "/tmp/global-root",
  });
  chatSessionRowMock.mockReset();
  chatSessionRowMock.mockReturnValue(null);
  persistTurnFailureRowMock.mockReset();
  interruptChatSessionMock.mockReset();
  interruptChatSessionMock.mockResolvedValue(undefined);
  buildAskFeatureDescriptorMock.mockReset();
  buildAskFeatureDescriptorMock.mockReturnValue({
    serverName: "vynel-ask",
    build: () => null,
    mutatingToolNames: [],
  });
});

/** A core stub that drains one text reply on the given session id. */
function coreReplying(sessionId: string, text: string) {
  coreMock.mockImplementation(
    async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: "user-message-persisted",
        message: { sessionId },
      } as SinkEvent);
      await sink.onEvent({ kind: "text-chunk", messageId: "m1", textDelta: text });
      await sink.onEnd?.();
    },
  );
}

type SettingsCoreInput = {
  permissionMode?: string;
  model?: string;
  thinkingEffort?: string;
  autoBuildout?: boolean;
};

describe("runGlobalRootTurn", () => {
  it("drains the sink: accumulates text chunks + captures the session id", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "sess-1" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "text-chunk",
          messageId: "m1",
          textDelta: "Hello ",
        });
        await sink.onEvent({
          kind: "text-chunk",
          messageId: "m1",
          textDelta: "world",
        });
        await sink.onEnd?.();
      },
    );

    const result = await runGlobalRootTurn(fakeDeps(), {
      userId: "u1",
      userMessageText: "hi",
    });

    expect(result).toEqual({ sessionId: "sess-1", resultText: "Hello world" });
    // Composed routing-only with a null build → an empty MCP set reaches the core.
    expect(coreMock).toHaveBeenCalledTimes(1);
    const coreInput = coreMock.mock.calls[0]?.[1] as {
      mcpServers: Record<string, unknown>;
      deniedMcpToolPatterns: string[];
    };
    expect(coreInput.mcpServers).toEqual({});
    expect(coreInput.deniedMcpToolPatterns).toEqual([]);
  });

  it("forwards approval-requested to onApprovalRequested (the channel card push, surface-up)", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "sess-1" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "approval-requested",
          approvalRequestId: "appr-brain-1",
          parentMessageId: "m1",
          toolName: "register_workspace",
          toolInput: { name: "acme" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "text-chunk",
          messageId: "m1",
          textDelta: "done",
        });
        await sink.onEnd?.();
      },
    );

    const approvals: {
      approvalRequestId: string;
      toolName: string;
      toolInput: unknown;
    }[] = [];
    const result = await runGlobalRootTurn(fakeDeps(), {
      userId: "u1",
      userMessageText: "set up acme",
      onApprovalRequested: (approval) => approvals.push(approval),
    });

    expect(result.resultText).toBe("done");
    expect(approvals).toEqual([
      {
        approvalRequestId: "appr-brain-1",
        toolName: "register_workspace",
        toolInput: { name: "acme" },
      },
    ]);
  });

  it("announces the turn on the activity feed: begin with the channel origin, session resolved, end", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "sess-1" },
        } as SinkEvent);
        await sink.onEnd?.();
      },
    );

    const activity = fakeActivityFeed();
    await runGlobalRootTurn(fakeDeps(activity.feed), {
      userId: "u1",
      userMessageText: "hi",
      originChannel: "telegram",
    });

    expect(activity.begin).toHaveBeenCalledWith({
      userId: "u1",
      scopeKind: "global",
      // Identity on the wire (session-hardening D1): every global turn names
      // its primary; the web reviewer caught the channel runner missing it.
      primarySessionId: "root-primary-1",
      origin: "telegram",
    });
    expect(activity.handle.sessionResolved).toHaveBeenCalledWith("sess-1");
    expect(activity.handle.end).toHaveBeenCalledTimes(1);
  });

  it("ends the activity turn even when the core throws", async () => {
    coreMock.mockRejectedValue(new Error("provider down"));

    const activity = fakeActivityFeed();
    await expect(
      runGlobalRootTurn(fakeDeps(activity.feed), {
        userId: "u1",
        userMessageText: "hi",
      }),
    ).rejects.toThrow("provider down");
    expect(activity.handle.end).toHaveBeenCalledTimes(1);
  });

  it("throws when the turn produced no session id (no user-message-persisted)", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "text-chunk",
          messageId: "m1",
          textDelta: "orphan",
        });
        await sink.onEnd?.();
      },
    );

    await expect(
      runGlobalRootTurn(fakeDeps(), { userId: "u1", userMessageText: "hi" }),
    ).rejects.toThrow(/did not assign a session id/);
  });

  it("throws with the in-stream error message when a session-errored event was captured", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "sess-1" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "session-errored",
          sessionId: "sess-1",
          errorCode: "provider_error",
          errorMessage: "boom",
          isRecoverable: false,
        });
        await sink.onEnd?.();
      },
    );

    await expect(
      runGlobalRootTurn(fakeDeps(), { userId: "u1", userMessageText: "hi" }),
    ).rejects.toThrow(/the global-root turn errored: boom/);
  });

  it("threads the notify-variant fields to the core (session-comms): child attribution, steer append, feed origin delegation", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "root-sess-1" },
        } as SinkEvent);
        await sink.onEnd?.();
      },
    );

    const activity = fakeActivityFeed();
    await runGlobalRootTurn(fakeDeps(activity.feed), {
      userId: "u1",
      userMessageText: "Backlog has 4 stale items.",
      inboundAttribution: {
        sourceKind: "workspace-manager",
        sourceLabel: "Acme research",
        partialSessionId: "delivery-trace-1",
      },
      steerPromptAppend: REPORT_DELIVERY_INSTRUCTIONS,
      activityOrigin: "delegation",
    });

    // The feed reports what is actually running — a delegation-driven turn.
    // test: correct expectation — persona-sessions enriches the delivery
    // turn's begin with the trace key + the speaking child's name.
    expect(activity.begin).toHaveBeenCalledWith({
      userId: "u1",
      scopeKind: "global",
      // Identity on the wire (session-hardening D1): every global turn names
      // its primary; the web reviewer caught the channel runner missing it.
      primarySessionId: "root-primary-1",
      origin: "delegation",
      partialSessionId: "delivery-trace-1",
      personaName: "Acme research",
    });
    const coreInput = coreMock.mock.calls[0]?.[1] as {
      messageAttribution?: Record<string, unknown>;
      steerPromptAppend?: string;
      autoContinue?: boolean;
    };
    expect(coreInput.messageAttribution).toEqual({
      userSourceKind: "workspace-manager",
      userSourceLabel: "Acme research",
      partialSessionId: "delivery-trace-1",
    });
    expect(coreInput.steerPromptAppend).toBe(REPORT_DELIVERY_INSTRUCTIONS);
    // A delivery turn is never work: the core neither nudges nor continues it.
    expect(coreInput.autoContinue).toBe(false);
  });

  it("a normal turn threads NEITHER notify field (the shipped core input, byte-for-byte)", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "sess-1" },
        } as SinkEvent);
        await sink.onEnd?.();
      },
    );
    await runGlobalRootTurn(fakeDeps(), {
      userId: "u1",
      userMessageText: "hi",
    });
    const coreInput = coreMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(coreInput).not.toHaveProperty("messageAttribution");
    expect(coreInput).not.toHaveProperty("steerPromptAppend");
    // …and stays a genuine turn: it may checkpoint + continue.
    expect(coreInput).not.toHaveProperty("autoContinue");
  });

  it("buildGlobalRootReportTurnRunner runs ONE notify turn and returns the session id + reply", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "root-sess-9" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "text-chunk",
          messageId: "m1",
          textDelta: "Absorbed.",
        });
        await sink.onEnd?.();
      },
    );

    const activity = fakeActivityFeed();
    const runReportTurn = buildGlobalRootReportTurnRunner(
      fakeDeps(activity.feed),
    );
    const turn = await runReportTurn({
      userId: "u1",
      reportBody: "All docs current.",
      sourceLabel: "Mark · Acme",
      partialSessionId: "delivery-trace-2",
    });

    expect(turn).toEqual({ sessionId: "root-sess-9", resultText: "Absorbed." });
    const coreInput = coreMock.mock.calls[0]?.[1] as {
      userMessageText: string;
      messageAttribution?: Record<string, unknown>;
      steerPromptAppend?: string;
    };
    expect(coreInput.userMessageText).toBe("All docs current.");
    expect(coreInput.messageAttribution).toEqual({
      userSourceKind: "workspace-manager",
      userSourceLabel: "Mark · Acme",
      partialSessionId: "delivery-trace-2",
    });
    expect(coreInput.steerPromptAppend).toBe(REPORT_DELIVERY_INSTRUCTIONS);
    // test: correct expectation — the runner threads the enrichment too.
    expect(activity.begin).toHaveBeenCalledWith({
      userId: "u1",
      scopeKind: "global",
      // Identity on the wire (session-hardening D1): every global turn names
      // its primary; the web reviewer caught the channel runner missing it.
      primarySessionId: "root-primary-1",
      origin: "delegation",
      partialSessionId: "delivery-trace-2",
      personaName: "Mark · Acme",
    });
  });

  it("buildGlobalRootReportTurnRunner marks the delivery's wait gate parked/resolved from the turn's OWN approval events and reports the session id (session-hardening A3a)", async () => {
    coreMock.mockImplementation(
      async (_deps: unknown, _input: unknown, sink: SessionSink) => {
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "root-sess-10" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "approval-requested",
          approvalRequestId: "appr-1",
          toolName: "Write",
          toolInput: {},
        } as SinkEvent);
        // A decision for a card THIS turn never parked must not move the gate.
        await sink.onEvent({
          kind: "approval-resolved",
          approvalRequestId: "someone-elses",
          decision: { kind: "approved" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "approval-resolved",
          approvalRequestId: "appr-1",
          decision: { kind: "approved" },
        } as SinkEvent);
        await sink.onEvent({
          kind: "session-created",
          session: { id: "root-sess-11" },
        } as SinkEvent);
        await sink.onEnd?.();
      },
    );
    const gateEdges: string[] = [];
    const waitGate = {
      markParked: () => gateEdges.push("parked"),
      markResolved: () => gateEdges.push("resolved"),
    };
    const resolvedSessionIds: string[] = [];
    const runReportTurn = buildGlobalRootReportTurnRunner(fakeDeps());
    await runReportTurn({
      userId: "u1",
      reportBody: "All docs current.",
      sourceLabel: "Mark · Acme",
      waitGate,
      onSessionResolved: (id) => resolvedSessionIds.push(id),
    });
    expect(gateEdges).toEqual(["parked", "resolved"]);
    // Both the early resumed id and the swapped segment reach the lever.
    expect(resolvedSessionIds).toEqual(["root-sess-10", "root-sess-11"]);
  });

  // ── Settings on channel turns (session-hardening D1/D3/D8) ──

  it("a channel turn on a mode-less global row runs the one default (auto) — never the unattended gate", async () => {
    coreReplying("sess-1", "ok");
    await runGlobalRootTurn(fakeDeps(), { userId: "u1", userMessageText: "hi" });
    const coreInput = coreMock.mock.calls[0]?.[1] as SettingsCoreInput;
    expect(coreInput.permissionMode).toBe("auto");
    expect(coreInput).not.toHaveProperty("model");
    expect(coreInput).not.toHaveProperty("thinkingEffort");
    expect(coreInput).not.toHaveProperty("autoBuildout");
  });

  it("a channel turn resolves the GLOBAL row's mode / model / effort / autopilot (input ?? row ?? default)", async () => {
    resolveTargetMock.mockResolvedValue({
      primarySessionId: "root-primary-1",
      resumeSdkSessionId: "global-head",
      workspacePath: "/tmp/global-root",
    });
    chatSessionRowMock.mockReturnValue({
      id: "global-head",
      sessionMode: "ask",
      selectedModel: "claude-sonnet-4-5",
      thinkingEffort: "high",
      autoBuildout: true,
      lastContextTokens: 1_000,
      model: "claude-sonnet-4-5",
    });
    coreReplying("global-head", "ok");
    await runGlobalRootTurn(fakeDeps(), { userId: "u1", userMessageText: "hi" });
    expect(chatSessionRowMock).toHaveBeenCalledWith(expect.anything(), "global-head");
    const coreInput = coreMock.mock.calls[0]?.[1] as SettingsCoreInput;
    expect(coreInput.permissionMode).toBe("ask");
    expect(coreInput.model).toBe("claude-sonnet-4-5");
    expect(coreInput.thinkingEffort).toBe("high");
    expect(coreInput.autoBuildout).toBe(true);
  });

  it("the fit guard clamps a stored small-model pick that cannot hold the global occupancy — never persisted", async () => {
    resolveTargetMock.mockResolvedValue({
      primarySessionId: "root-primary-1",
      resumeSdkSessionId: "global-head",
      workspacePath: "/tmp/global-root",
    });
    chatSessionRowMock.mockReturnValue({
      id: "global-head",
      sessionMode: null,
      selectedModel: "claude-haiku-4-5",
      thinkingEffort: null,
      autoBuildout: null,
      // 400k grown under a 1M model — a 200k pin would die "Prompt is too long".
      lastContextTokens: 400_000,
      model: "claude-opus-4-6",
      // The chain reader (slice G) owner-gates its walk and prefers a persisted
      // window — a legacy row: no window yet, single segment, this user's.
      userId: "u1",
      lastContextWindow: null,
      continuedFromSessionId: null,
    });
    coreReplying("global-head", "ok");
    await runGlobalRootTurn(fakeDeps(), { userId: "u1", userMessageText: "hi" });
    const coreInput = coreMock.mock.calls[0]?.[1] as SettingsCoreInput;
    expect(coreInput.model).toBe("claude-opus-4-6");
    expect(coreInput.permissionMode).toBe("auto");
  });

  it("wrapAppRequestWithOrigin stamps the serialized origin header on every dispatch", async () => {
    const seen: (RequestInit | undefined)[] = [];
    const appRequest = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        seen.push(init);
        return new Response("ok");
      },
    );
    const origin = {
      channelId: "c1",
      externalSenderId: "s1",
      externalChatContextId: "ctx1",
    };

    const wrapped = wrapAppRequestWithOrigin(appRequest, origin);
    await wrapped("/routing/delegate", { method: "POST" });

    const headers = new Headers(seen[0]?.headers);
    expect(headers.get(DELEGATION_ORIGIN_HEADER)).toBe(
      serializeDelegationOrigin(origin),
    );
  });
});

// ── The wall clock (background-turns BT4 / audit R2-B) ──
//
// The REAL clock helpers run over fake timers: `startTurnWallClock` +
// `trackApprovalParks` + `failTurnOnWallClock`, with the chat boundary mocked
// (the failure row, and an interrupt that RELEASES the hung core stub the way
// the SDK ends an interrupted session — cleanly, no terminal error event).
describe("runGlobalRootTurn — the wall clock (BT4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  /** A core stub that resolves its target (the in-lock call that arms the
   *  clock), persists the user row on `sessionId`, runs `beforeHang` (the
   *  test's approval choreography), then HANGS until interrupted. */
  function coreHangingUntilInterrupted(
    sessionId: string,
    beforeHang?: (sink: SessionSink) => Promise<void>,
  ) {
    const released = deferred();
    interruptChatSessionMock.mockImplementation(
      async (_providerId: string, interruptedSessionId: string) => {
        if (interruptedSessionId === sessionId) released.resolve();
      },
    );
    coreMock.mockImplementation(
      async (deps: RunGlobalRootTurnCoreDeps, _input: unknown, sink: SessionSink) => {
        await deps.resolveTarget();
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId },
        } as SinkEvent);
        await beforeHang?.(sink);
        await released.promise;
        await sink.onEnd?.();
      },
    );
    return released;
  }

  /** Start the runner and capture its settlement without an unhandled rejection
   *  while the fake clock is advanced. */
  function startTurn(
    activity: ReturnType<typeof fakeActivityFeed>,
    input: Parameters<typeof runGlobalRootTurn>[1],
  ) {
    return runGlobalRootTurn(fakeDeps(activity.feed), input).then(
      (turn) => ({ kind: "resolved" as const, turn }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
  }

  it("a bounded turn past maxMs fails the streams' way: failure row + interrupt on the turn's session, feed FAILED, the typed throw", async () => {
    coreHangingUntilInterrupted("sess-hung");
    const activity = fakeActivityFeed();
    const settled = startTurn(activity, {
      userId: "u1",
      userMessageText: "never ends",
      wallClock: { maxMs: 60 },
    });

    await vi.advanceTimersByTimeAsync(59);
    expect(interruptChatSessionMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const outcome = await settled;
    expect(outcome.kind).toBe("rejected");
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(TurnWallClockExceededError);
    expect((error as TurnWallClockExceededError).errorCode).toBe("turn-wall-clock-exceeded");
    expect((error as Error).message).toBe("turn exceeded the 0.001-minute limit");
    // The streams' persistence: the honest failure row on THE turn's session…
    expect(persistTurnFailureRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-hung",
        errorCode: "turn-wall-clock-exceeded",
        errorMessage: "turn exceeded the 0.001-minute limit",
      }),
    );
    // …the interrupt that ends the stream (and releases the lock through the
    // core's chain), and the feed's durable outcome.
    expect(interruptChatSessionMock).toHaveBeenCalledWith("claude", "sess-hung");
    expect(activity.handle.end).toHaveBeenCalledWith("failed");
  });

  it("a parked approval suspends the clock — deciding time never counts — and the remaining budget runs on after the decision", async () => {
    const cardRaised = deferred();
    const decided = deferred();
    coreHangingUntilInterrupted("sess-parked", async (sink) => {
      await cardRaised.promise;
      await sink.onEvent({
        kind: "approval-requested",
        approvalRequestId: "appr-1",
        parentMessageId: "m1",
        toolName: "register_workspace",
        toolInput: {},
      } as SinkEvent);
      await decided.promise;
      // A decision for a card THIS turn never parked must not release it.
      await sink.onEvent({
        kind: "approval-resolved",
        approvalRequestId: "someone-elses",
        decision: { kind: "approved" },
      } as SinkEvent);
      await sink.onEvent({
        kind: "approval-resolved",
        approvalRequestId: "appr-1",
        decision: { kind: "approved" },
      } as SinkEvent);
    });
    const activity = fakeActivityFeed();
    const settled = startTurn(activity, {
      userId: "u1",
      userMessageText: "needs a card",
      wallClock: { maxMs: 100 },
    });

    // 40 ms of working time, then the card parks the turn.
    await vi.advanceTimersByTimeAsync(40);
    cardRaised.resolve();
    await vi.advanceTimersByTimeAsync(0);
    // A human takes far longer than the whole budget to decide: no expiry.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(interruptChatSessionMock).not.toHaveBeenCalled();
    expect(persistTurnFailureRowMock).not.toHaveBeenCalled();

    // Decided: the clock resumes with its remaining 60 ms.
    decided.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(59);
    expect(interruptChatSessionMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const outcome = await settled;
    expect(outcome.kind).toBe("rejected");
    expect((outcome as { error: unknown }).error).toBeInstanceOf(TurnWallClockExceededError);
    expect(interruptChatSessionMock).toHaveBeenCalledWith("claude", "sess-parked");
  });

  it("a bounded turn that finishes inside the budget is untouched: no interrupt, no failure row, the drained result", async () => {
    coreMock.mockImplementation(
      async (deps: RunGlobalRootTurnCoreDeps, _input: unknown, sink: SessionSink) => {
        await deps.resolveTarget();
        await sink.onEvent({
          kind: "user-message-persisted",
          message: { sessionId: "sess-quick" },
        } as SinkEvent);
        await sink.onEvent({ kind: "text-chunk", messageId: "m1", textDelta: "done" });
        await sink.onEnd?.();
      },
    );
    const activity = fakeActivityFeed();
    const settled = startTurn(activity, {
      userId: "u1",
      userMessageText: "quick",
      wallClock: { maxMs: 60 },
    });
    await vi.advanceTimersByTimeAsync(0);
    const outcome = await settled;
    expect(outcome).toEqual({
      kind: "resolved",
      turn: { sessionId: "sess-quick", resultText: "done" },
    });
    // The clock was cleared at turn end — advancing past the budget fires nothing.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(interruptChatSessionMock).not.toHaveBeenCalled();
    expect(persistTurnFailureRowMock).not.toHaveBeenCalled();
    expect(activity.handle.end).toHaveBeenCalledWith("ended");
  });

  it("absent `wallClock` = the shipped shape: an unbounded turn is never interrupted, however long it runs", async () => {
    const released = coreHangingUntilInterrupted("sess-unbounded");
    const activity = fakeActivityFeed();
    const settled = startTurn(activity, {
      userId: "u1",
      userMessageText: "takes forever",
    });
    // Far past every knob's default (60 min): still running, nothing fired.
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(interruptChatSessionMock).not.toHaveBeenCalled();
    expect(persistTurnFailureRowMock).not.toHaveBeenCalled();
    // The turn ends on its own terms.
    released.resolve();
    await vi.advanceTimersByTimeAsync(0);
    const outcome = await settled;
    expect(outcome).toEqual({
      kind: "resolved",
      turn: { sessionId: "sess-unbounded", resultText: "" },
    });
    expect(activity.handle.end).toHaveBeenCalledWith("ended");
  });

  it("the channel ask descriptor rides the turn's wait gate (a parked ask suspends the clock) with the channel bound", async () => {
    coreReplying("sess-1", "ok");
    const askWaiters = {
      cancelForTurn: vi.fn(() => []),
    } as unknown as PendingAskRegistry;
    await runGlobalRootTurn(
      { ...fakeDeps(), askWaiters },
      { userId: "u1", userMessageText: "hi", wallClock: { maxMs: 60_000 } },
    );
    expect(buildAskFeatureDescriptorMock).toHaveBeenCalledTimes(1);
    const askDeps = buildAskFeatureDescriptorMock.mock.calls[0]?.[0] as {
      waiters: unknown;
      timeoutMs: number;
      waitGate?: { markParked: () => void; markResolved: () => void };
    };
    expect(askDeps.waiters).toBe(askWaiters);
    expect(askDeps.timeoutMs).toBe(10 * 60 * 1000);
    expect(askDeps.waitGate).toBeDefined();
    expect(typeof askDeps.waitGate?.markParked).toBe("function");
  });
});
