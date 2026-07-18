import type {
  ChatMessageResponse,
  ChatSessionResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";

// Folds the raw ChatTurnEvent stream into one renderable view of the turn in
// flight. Pure — transport-blind and framework-blind — so the demo player and
// the future SSE reader feed the exact same logic.

export interface ActiveTurnApproval {
  approvalRequestId: string;
  parentMessageId: string;
  toolName: string;
  toolInput: unknown;
  requestedAt: string;
  isResolved: boolean;
}

export interface ActiveTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export type ActiveTurnStatus =
  "streaming" | "completed" | "interrupted" | "errored";

export interface ActiveTurnView {
  status: ActiveTurnStatus;
  session: ChatSessionResponse | null;
  userMessage: ChatMessageResponse | null;
  assistantMessageId: string | null;
  /** EVERY assistant message id this turn touched (a turn with tool calls
   *  spans several) — the thread hides these persisted rows while the live
   *  overlay renders them, so a mid-turn refetch never doubles a message. */
  assistantMessageIds: string[];
  text: string;
  thinking: string;
  isThinkingLive: boolean;
  toolCalls: ChatToolCallResponse[];
  approvals: ActiveTurnApproval[];
  usage: ActiveTurnUsage | null;
  error: { code: string; message: string; isRecoverable: boolean } | null;
  hasEnded: boolean;
}

export function createActiveTurnView(): ActiveTurnView {
  return {
    status: "streaming",
    session: null,
    userMessage: null,
    assistantMessageId: null,
    assistantMessageIds: [],
    text: "",
    thinking: "",
    isThinkingLive: false,
    toolCalls: [],
    approvals: [],
    usage: null,
    error: null,
    hasEnded: false,
  };
}

function upsertToolCall(
  toolCalls: ChatToolCallResponse[],
  incoming: ChatToolCallResponse,
): ChatToolCallResponse[] {
  const index = toolCalls.findIndex((row) => row.id === incoming.id);
  if (index === -1) return [...toolCalls, incoming];
  const next = [...toolCalls];
  next[index] = incoming;
  return next;
}

function withAssistantMessageId(
  ids: string[],
  messageId: string,
): string[] {
  return ids.includes(messageId) ? ids : [...ids, messageId];
}

export function applyChatTurnEvent(
  view: ActiveTurnView,
  event: ChatTurnEvent,
): ActiveTurnView {
  switch (event.kind) {
    case "session-created":
      return { ...view, session: event.session };
    case "user-message-persisted":
      return { ...view, userMessage: event.message };
    case "session-titled":
      return view.session
        ? { ...view, session: { ...view.session, title: event.title } }
        : view;
    case "text-chunk":
      return {
        ...view,
        assistantMessageId: event.messageId,
        assistantMessageIds: withAssistantMessageId(
          view.assistantMessageIds,
          event.messageId,
        ),
        text: view.text + event.textDelta,
        isThinkingLive: false,
      };
    case "thinking-chunk":
      return {
        ...view,
        assistantMessageId: event.messageId,
        assistantMessageIds: withAssistantMessageId(
          view.assistantMessageIds,
          event.messageId,
        ),
        thinking: view.thinking + event.thinkingDelta,
        isThinkingLive: true,
      };
    case "tool-call-started":
    case "tool-call-completed":
      return {
        ...view,
        toolCalls: upsertToolCall(view.toolCalls, event.toolCall),
        // A tool-only assistant message never streams text — its parent row
        // still belongs to this turn's overlay.
        assistantMessageIds: withAssistantMessageId(
          view.assistantMessageIds,
          event.toolCall.parentMessageId,
        ),
        isThinkingLive: false,
      };
    case "approval-requested":
      return {
        ...view,
        approvals: [
          ...view.approvals,
          {
            approvalRequestId: event.approvalRequestId,
            parentMessageId: event.parentMessageId,
            toolName: event.toolName,
            toolInput: event.toolInput,
            requestedAt: event.requestedAt,
            isResolved: false,
          },
        ],
      };
    case "approval-resolved":
    case "approval-auto-resolved":
      return {
        ...view,
        approvals: view.approvals.map((approval) =>
          approval.approvalRequestId === event.approvalRequestId
            ? { ...approval, isResolved: true }
            : approval,
        ),
      };
    case "usage-reported":
      return {
        ...view,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadInputTokens: event.cacheReadInputTokens,
          cacheCreationInputTokens: event.cacheCreationInputTokens,
        },
      };
    case "session-completed":
      return { ...view, status: "completed" };
    case "session-interrupted":
      return { ...view, status: "interrupted" };
    case "session-errored":
      return {
        ...view,
        status: "errored",
        error: {
          code: event.errorCode,
          message: event.errorMessage,
          isRecoverable: event.isRecoverable,
        },
      };
    case "turn-stream-ended":
      return { ...view, hasEnded: true };
  }
}
