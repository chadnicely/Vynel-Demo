import type {
  ChatMessageResponse,
  ChatSessionResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import type { DemoTurnStep } from "./chat-turn-player.js";
import { makeDemoId } from "./demo-ids.js";

export interface DemoTurnScript {
  steps: DemoTurnStep[];
  userMessage: ChatMessageResponse;
  assistantMessageId: string;
}

export function emit(delayMs: number, event: ChatTurnEvent): DemoTurnStep {
  return { kind: "emit", delayMs, event };
}

export function textChunks(
  messageId: string,
  text: string,
  delayMs = 90,
): DemoTurnStep[] {
  // Stream in word-groups so the answer visibly types itself.
  const words = text.split(" ");
  const steps: DemoTurnStep[] = [];
  for (let i = 0; i < words.length; i += 4) {
    const chunk =
      words.slice(i, i + 4).join(" ") + (i + 4 < words.length ? " " : "");
    steps.push(
      emit(delayMs, { kind: "text-chunk", messageId, textDelta: chunk }),
    );
  }
  return steps;
}

export function makeToolCall(
  assistantMessageId: string,
  base: number,
  offsetMs: number,
  durationMs: number,
  toolName: string,
  toolInput: unknown,
  toolOutput: unknown,
): ChatToolCallResponse {
  return {
    id: makeDemoId("tool"),
    parentMessageId: assistantMessageId,
    toolUseId: makeDemoId("tooluse"),
    toolName,
    toolInput,
    toolOutput,
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    startedAt: new Date(base + offsetMs).toISOString(),
    completedAt: new Date(base + offsetMs + durationMs).toISOString(),
  };
}

export function toolSteps(
  toolCall: ChatToolCallResponse,
  runMs: number,
): DemoTurnStep[] {
  return [
    emit(220, {
      kind: "tool-call-started",
      toolCall: {
        ...toolCall,
        status: "started",
        toolOutput: null,
        completedAt: null,
      },
    }),
    emit(runMs, { kind: "tool-call-completed", toolCall }),
  ];
}

/**
 * A realistic "workspace task" turn: think → read → search → an edit that
 * needs approval → verify → report. Exercises every ChatTurnEvent kind the
 * activity feed renders.
 */
export function buildDemoTurnScript(options: {
  session: ChatSessionResponse;
  userText: string;
  isNewSession: boolean;
}): DemoTurnScript {
  const { session, userText, isNewSession } = options;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const userMessage: ChatMessageResponse = {
    id: makeDemoId("msg"),
    sessionId: session.id,
    role: "user",
    body: userText,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: nowIso,
    completedAt: nowIso,
    createdAt: nowIso,
  };

  const assistantMessageId = makeDemoId("msg");

  const readCall = makeToolCall(
    assistantMessageId,
    now,
    1200,
    1150,
    "Read",
    { file_path: "site/pricing.md" },
    "# Pricing\n\nStarter — $19/mo\nPro — $39/mo\nTeam — $99/mo",
  );
  const grepCall = makeToolCall(
    assistantMessageId,
    now,
    2600,
    420,
    "Grep",
    { pattern: "\\$39", glob: "site/**" },
    "site/pricing.md:4\nsite/landing.md:12",
  );
  const editCall = makeToolCall(
    assistantMessageId,
    now,
    4200,
    900,
    "Edit",
    {
      file_path: "site/pricing.md",
      old_string: "Pro — $39/mo",
      new_string: "Pro — $49/mo",
    },
    "Replaced 1 occurrence",
  );
  const bashCall = makeToolCall(
    assistantMessageId,
    now,
    5400,
    2100,
    "Bash",
    { command: "npm run build" },
    "✓ built in 1.9s — 0 errors",
  );
  const deniedEditCall: ChatToolCallResponse = {
    ...editCall,
    id: makeDemoId("tool"),
    status: "denied",
    approvalStatus: "denied",
    toolOutput: null,
  };

  const approvalRequestId = makeDemoId("approval");

  const steps: DemoTurnStep[] = [
    ...(isNewSession
      ? [emit(200, { kind: "session-created", session } as const)]
      : []),
    emit(120, { kind: "user-message-persisted", message: userMessage }),
    emit(600, {
      kind: "thinking-chunk",
      messageId: assistantMessageId,
      thinkingDelta: "The user wants the pricing updated. ",
    }),
    emit(500, {
      kind: "thinking-chunk",
      messageId: assistantMessageId,
      thinkingDelta:
        "I should read the current page, find every place the old price appears, then change it and verify the build.",
    }),
    ...textChunks(
      assistantMessageId,
      "On it. Let me look at the current pricing page first.\n\n",
    ),
    ...toolSteps(readCall, 1150),
    ...toolSteps(grepCall, 420),
    ...textChunks(
      assistantMessageId,
      "Found it in two places. I'll update the pricing file — this change needs your approval.\n\n",
    ),
    {
      kind: "approval-gate",
      delayMs: 300,
      approvalRequestId,
      parentMessageId: assistantMessageId,
      toolName: "Edit",
      toolInput: editCall.toolInput,
      approved: [
        ...toolSteps(editCall, 900),
        ...toolSteps(bashCall, 2100),
        ...textChunks(
          assistantMessageId,
          "Done. The Pro plan now shows **$49/mo** and the site build passed with no errors. The landing page mention is copy inside a quote, so I left it — say the word if you want that one changed too.",
        ),
      ],
      denied: [
        emit(300, { kind: "tool-call-completed", toolCall: deniedEditCall }),
        ...textChunks(
          assistantMessageId,
          "Understood — I left the file untouched. The old price is still live; tell me what you'd like different and I'll try again.",
        ),
      ],
    },
    emit(400, {
      kind: "usage-reported",
      inputTokens: 2140,
      outputTokens: 830,
      cacheReadInputTokens: 4620,
      cacheCreationInputTokens: 0,
    }),
    emit(150, { kind: "session-completed", sessionId: session.id }),
    emit(50, { kind: "turn-stream-ended" }),
  ];

  return { steps, userMessage, assistantMessageId };
}
