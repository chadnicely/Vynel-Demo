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
        text: view.text + event.textDelta,
        isThinkingLive: false,
      };
    case "thinking-chunk":
      return {
        ...view,
        assistantMessageId: event.messageId,
        thinking: view.thinking + event.thinkingDelta,
        isThinkingLive: true,
      };
    case "tool-call-started":
    case "tool-call-completed":
      return {
        ...view,
        toolCalls: upsertToolCall(view.toolCalls, event.toolCall),
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
