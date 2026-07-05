import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import type { ActiveTurnView } from "../composables/chat/active-turn-view.js";
import type { DemoTurnResult } from "./demo-store.js";

export interface AssistantMessageExtras {
  /** Link to a delegated child session — renders the "watch live" chip. */
  partialSessionId?: string;
  sourceLabel?: string;
  sourceKind?: ChatMessageResponse["sourceKind"];
}

// Mirrors what the real backend persists server-side after a turn: the
// finished stream's view becomes the chat-history rows. Used by the main
// chat turn AND the delegation scenario's child streams.
export function buildTurnResultFromView(options: {
  sessionId: string;
  userMessage: ChatMessageResponse;
  assistantMessageId: string;
  view: ActiveTurnView;
  extras?: AssistantMessageExtras;
}): DemoTurnResult | null {
  const { sessionId, userMessage, assistantMessageId, view, extras } = options;
  if (view.text.length === 0) return null;

  const now = new Date().toISOString();
  const assistantMessage: ChatMessageResponse = {
    id: assistantMessageId,
    sessionId,
    role: "assistant",
    ...(extras?.sourceKind !== undefined && { sourceKind: extras.sourceKind }),
    ...(extras?.sourceLabel !== undefined && {
      sourceLabel: extras.sourceLabel,
    }),
    ...(extras?.partialSessionId !== undefined && {
      partialSessionId: extras.partialSessionId,
    }),
    body: view.text,
    thinkingBody: view.thinking.length > 0 ? view.thinking : null,
    inputTokens: view.usage?.inputTokens ?? null,
    outputTokens: view.usage?.outputTokens ?? null,
    attachedImagesMetadata: null,
    errorCode: view.error?.code ?? null,
    errorMessage: view.error?.message ?? null,
    startedAt: userMessage.createdAt,
    completedAt: view.status === "completed" ? now : null,
    createdAt: now,
  };

  return { userMessage, assistantMessage, toolCalls: view.toolCalls };
}
