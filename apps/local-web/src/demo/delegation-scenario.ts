import type { QueryClient } from "@tanstack/vue-query";
import type {
  ChatMessageResponse,
  ChatSessionResponse,
} from "@vynel/contracts/chat/chat-http";
import { sessionKeys } from "../composables/chat/session-keys.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useLiveSessionsStore } from "../stores/live-sessions-store.js";
import type { DemoTurnStep } from "./chat-turn-player.js";
import { playDemoTurn } from "./chat-turn-player.js";
import { demoStore } from "./demo-store.js";
import { makeDemoId } from "./demo-ids.js";
import { buildTurnResultFromView } from "./persist-turn.js";
import type { AssistantMessageExtras } from "./persist-turn.js";
import type { DemoTurnScript } from "./turn-script.js";
import { emit, makeToolCall, textChunks, toolSteps } from "./turn-script.js";

// The "one brain, many hands" demo: a GLOBAL turn hands the task to the
// Marketing workspace (Mara), which delegates copy polish to a Writer agent —
// each hop leaves a "watch live" link (partialSessionId) and each child
// session streams in realtime through the live-sessions store, so the
// session viewer can follow the whole cascade.

/** What use-chat-turn plays: a script plus the delegation hooks. */
export interface DemoTurnPlan extends DemoTurnScript {
  assistantExtras?: AssistantMessageExtras;
  startChildren?: (queryClient: QueryClient) => void;
}

function makeMessageRow(options: {
  sessionId: string;
  role: ChatMessageResponse["role"];
  body: string;
  sourceKind?: ChatMessageResponse["sourceKind"];
  sourceLabel?: string;
  partialSessionId?: string;
}): ChatMessageResponse {
  const now = new Date().toISOString();
  return {
    id: makeDemoId("msg"),
    sessionId: options.sessionId,
    role: options.role,
    ...(options.sourceKind !== undefined && { sourceKind: options.sourceKind }),
    ...(options.sourceLabel !== undefined && {
      sourceLabel: options.sourceLabel,
    }),
    ...(options.partialSessionId !== undefined && {
      partialSessionId: options.partialSessionId,
    }),
    body: options.body,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  };
}

/** Run one child stream into the live registry, then persist it. */
async function runChildStream(options: {
  session: ChatSessionResponse;
  userMessage: ChatMessageResponse;
  steps: DemoTurnStep[];
  assistantMessageId: string;
  extras?: AssistantMessageExtras;
  queryClient: QueryClient;
}): Promise<void> {
  const live = useLiveSessionsStore();
  const activity = useActivityStore();

  live.begin(options.session.id);
  live.ingest(options.session.id, {
    kind: "user-message-persisted",
    message: options.userMessage,
  });
  activity.turnStarted();

  const handle = playDemoTurn(options.session.id, options.steps, (event) =>
    live.ingest(options.session.id, event),
  );
  try {
    await handle.done;
  } finally {
    activity.turnEnded();
  }

  const finalView = live.liveFor(options.session.id);
  if (finalView) {
    const result = buildTurnResultFromView({
      sessionId: options.session.id,
      userMessage: options.userMessage,
      assistantMessageId: options.assistantMessageId,
      view: finalView,
      ...(options.extras !== undefined && { extras: options.extras }),
    });
    if (result) demoStore.appendTurnResult(options.session.id, result);
  }
  live.end(options.session.id);
  await options.queryClient.invalidateQueries({ queryKey: sessionKeys.all });
}

/** The global turn: a quick, confident handoff that links the workspace run. */
export function buildGlobalDelegationTurn(options: {
  session: ChatSessionResponse;
  userText: string;
  isNewSession: boolean;
}): DemoTurnPlan {
  const { session, userText, isNewSession } = options;
  const nowIso = new Date().toISOString();

  const userMessage: ChatMessageResponse = makeMessageRow({
    sessionId: session.id,
    role: "user",
    body: userText,
  });
  const assistantMessageId = makeDemoId("msg");

  // Children are created up front so every link has a real session id.
  const workspaceSession = demoStore.createSession(
    "demo-ws-marketing",
    userText.length > 44 ? `${userText.slice(0, 44)}…` : userText,
  );
  const agentSession = demoStore.createSession(
    "demo-ws-marketing",
    "Writer agent — copy polish",
  );

  const steps: DemoTurnStep[] = [
    ...(isNewSession
      ? [emit(200, { kind: "session-created", session } as const)]
      : []),
    emit(120, {
      kind: "user-message-persisted",
      message: { ...userMessage, createdAt: nowIso },
    }),
    emit(700, {
      kind: "thinking-chunk",
      messageId: assistantMessageId,
      thinkingDelta:
        "This is Marketing site work. Mara holds that room's context — routing it to her.",
    }),
    ...textChunks(
      assistantMessageId,
      "This one's for **Mara in Marketing site** — I've handed it over. You can watch her work live below; I'll report back here when it's done.",
    ),
    emit(300, {
      kind: "usage-reported",
      inputTokens: 940,
      outputTokens: 180,
      cacheReadInputTokens: 3200,
      cacheCreationInputTokens: 0,
    }),
    emit(150, { kind: "session-completed", sessionId: session.id }),
    emit(50, { kind: "turn-stream-ended" }),
  ];

  function startChildren(queryClient: QueryClient) {
    void runDelegationCascade({
      globalSessionId: session.id,
      workspaceSession,
      agentSession,
      taskText: userText,
      queryClient,
    });
  }

  return {
    steps,
    userMessage,
    assistantMessageId,
    assistantExtras: {
      partialSessionId: workspaceSession.id,
      sourceLabel: "Marketing site · Mara",
    },
    startChildren,
  };
}

async function runDelegationCascade(options: {
  globalSessionId: string;
  workspaceSession: ChatSessionResponse;
  agentSession: ChatSessionResponse;
  taskText: string;
  queryClient: QueryClient;
}): Promise<void> {
  const {
    globalSessionId,
    workspaceSession,
    agentSession,
    taskText,
    queryClient,
  } = options;
  const base = Date.now();

  // ── Workspace, turn A: take the task, delegate the copy to the agent.
  const wsAssistantA = makeDemoId("msg");
  await runChildStream({
    session: workspaceSession,
    userMessage: makeMessageRow({
      sessionId: workspaceSession.id,
      role: "user",
      sourceKind: "global-root",
      sourceLabel: "Global",
      body: taskText,
    }),
    assistantMessageId: wsAssistantA,
    steps: [
      emit(900, {
        kind: "thinking-chunk",
        messageId: wsAssistantA,
        thinkingDelta:
          "The landing copy needs a rewrite. I'll have the Writer agent draft the tone pass while I prepare the change.",
      }),
      ...toolSteps(
        makeToolCall(
          wsAssistantA,
          base,
          1600,
          950,
          "Read",
          { file_path: "site/landing.md" },
          '# Do your best work, calmly\n\n> "We switched in an afternoon…"',
        ),
        950,
      ),
      ...textChunks(
        wsAssistantA,
        "Taking this. I've read the current landing page and sent the tone polish to the **Writer agent** — watch the draft come together live.",
      ),
      emit(200, { kind: "session-completed", sessionId: workspaceSession.id }),
      emit(50, { kind: "turn-stream-ended" }),
    ],
    extras: { partialSessionId: agentSession.id, sourceLabel: "Writer agent" },
    queryClient,
  });

  // ── Agent: the Writer polishes the copy.
  const agentAssistant = makeDemoId("msg");
  await runChildStream({
    session: agentSession,
    userMessage: makeMessageRow({
      sessionId: agentSession.id,
      role: "user",
      sourceKind: "workspace-manager",
      sourceLabel: "Mara",
      body: "Polish the hero copy in site/landing.md — calm, plain, confident. Brand voice rules apply.",
    }),
    assistantMessageId: agentAssistant,
    steps: [
      emit(800, {
        kind: "thinking-chunk",
        messageId: agentAssistant,
        thinkingDelta:
          "Brand voice: calm, plain, confident. No hype, short sentences. ",
      }),
      ...toolSteps(
        makeToolCall(
          agentAssistant,
          base,
          9000,
          700,
          "Read",
          { file_path: "brand-voice.md" },
          "# Brand voice\n\nCalm, plain, confident. We explain, we never hype.",
        ),
        700,
      ),
      emit(900, {
        kind: "thinking-chunk",
        messageId: agentAssistant,
        thinkingDelta:
          "Lead with the outcome, drop the exclamation energy, keep the customer quote.",
      }),
      ...textChunks(
        agentAssistant,
        "Draft ready:\n\n> **Work, minus the chaos.**\n> Your projects, files, and follow-ups in one calm place — set up in an afternoon.\n\nKept the customer quote as social proof. Two sentences, zero hype, matches the voice rules.",
        110,
      ),
      emit(300, {
        kind: "usage-reported",
        inputTokens: 1650,
        outputTokens: 240,
        cacheReadInputTokens: 2100,
        cacheCreationInputTokens: 0,
      }),
      emit(200, { kind: "session-completed", sessionId: agentSession.id }),
      emit(50, { kind: "turn-stream-ended" }),
    ],
    queryClient,
  });

  // ── Workspace, turn B: apply the agent's draft and verify.
  const wsAssistantB = makeDemoId("msg");
  await runChildStream({
    session: workspaceSession,
    userMessage: makeMessageRow({
      sessionId: workspaceSession.id,
      role: "assistant",
      sourceKind: "agent",
      sourceLabel: "Writer",
      body: "Draft ready: “Work, minus the chaos.” — two sentences, zero hype, voice rules applied.",
    }),
    assistantMessageId: wsAssistantB,
    steps: [
      ...textChunks(
        wsAssistantB,
        "The Writer's draft reads right. Applying it to the landing page and verifying the build.",
      ),
      ...toolSteps(
        makeToolCall(
          wsAssistantB,
          base,
          22000,
          900,
          "Edit",
          {
            file_path: "site/landing.md",
            old_string: "# Do your best work, calmly",
            new_string: "# Work, minus the chaos.",
          },
          "Replaced 1 occurrence",
        ),
        900,
      ),
      ...toolSteps(
        makeToolCall(
          wsAssistantB,
          base,
          24000,
          2100,
          "Bash",
          { command: "npm run build" },
          "✓ built in 1.8s — 0 errors",
        ),
        2100,
      ),
      ...textChunks(
        wsAssistantB,
        "Done — the landing page opens with the Writer's new hero and the site builds clean.",
      ),
      emit(200, { kind: "session-completed", sessionId: workspaceSession.id }),
      emit(50, { kind: "turn-stream-ended" }),
    ],
    queryClient,
  });

  // ── The loop closes: Mara's report bubbles back to the global brain.
  demoStore.appendTurnResult(globalSessionId, {
    userMessage: makeMessageRow({
      sessionId: globalSessionId,
      role: "assistant",
      sourceKind: "workspace-manager",
      sourceLabel: "Mara",
      partialSessionId: workspaceSession.id,
      body: "Marketing site: landing copy refreshed with the Writer's new hero — build verified.",
    }),
    assistantMessage: makeMessageRow({
      sessionId: globalSessionId,
      role: "assistant",
      body: "All done — **Marketing site's landing page** now opens with the new hero copy, and the build passed. Anything else for that room?",
    }),
    toolCalls: [],
  });
  await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
}
