import type {
  ChatMessageResponse,
  ChatSessionResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";

// Folds the raw ChatTurnEvent stream into one renderable view of the turn in
// flight. Pure — transport-blind and framework-blind — so the demo player and
// the future SSE reader feed the exact same logic.
//
// The turn is SEGMENTED by assistant message, in arrival order — a turn with
// tool calls spans several assistant messages (text → tools → text), and the
// settled thread renders each as its own block with its tool calls attached.
// The live overlay mirrors that structure exactly, so nothing reflows when
// the turn settles (or the page reloads).

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

/** One assistant message of the in-flight turn — the live mirror of a settled
 *  MessageRow: its thinking, its text, and the tool calls it made. */
export interface ActiveTurnSegment {
  messageId: string;
  text: string;
  thinking: string;
  toolCalls: ChatToolCallResponse[];
}

/** One nested tool call a SUBAGENT made — the live mirror of the lean entry
 *  persisted on the Agent call's row (subagentToolCalls); the card's settled
 *  toolOutput carries the final report. */
export interface AgentActivityToolCall {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  toolOutput: unknown;
  status: "started" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
}

/** A running subagent's live activity, keyed by its spawning Agent tool
 *  call's toolUseId — rendered nested under that card. */
export interface AgentActivityView {
  text: string;
  toolCalls: AgentActivityToolCall[];
}

export type ActiveTurnStatus =
  "streaming" | "completed" | "interrupted" | "errored";

export interface ActiveTurnView {
  status: ActiveTurnStatus;
  /** When the user hit send (client clock) — the working chip's elapsed timer. */
  startedAtMs: number;
  session: ChatSessionResponse | null;
  userMessage: ChatMessageResponse | null;
  /** The turn's assistant messages in arrival order. Their ids double as the
   *  dedupe set — the thread hides these persisted rows while the overlay
   *  renders them (rows persist per chunk, so they exist mid-turn). */
  segments: ActiveTurnSegment[];
  /** Subagent activity by the spawning Agent tool call's toolUseId. */
  agentActivity: Record<string, AgentActivityView>;
  isThinkingLive: boolean;
  approvals: ActiveTurnApproval[];
  usage: ActiveTurnUsage | null;
  error: { code: string; message: string; isRecoverable: boolean } | null;
  hasEnded: boolean;
}

export function createActiveTurnView(): ActiveTurnView {
  return {
    status: "streaming",
    startedAtMs: Date.now(),
    session: null,
    userMessage: null,
    segments: [],
    agentActivity: {},
    isThinkingLive: false,
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

/** Apply `patch` to a subagent's activity, creating it on first sight. */
function patchAgentActivity(
  activity: Record<string, AgentActivityView>,
  parentToolUseId: string,
  patch: (entry: AgentActivityView) => AgentActivityView,
): Record<string, AgentActivityView> {
  const current = activity[parentToolUseId] ?? { text: "", toolCalls: [] };
  return { ...activity, [parentToolUseId]: patch(current) };
}

/** Apply `patch` to the message's segment, creating it (in arrival order) on
 *  first sight. Pure — returns a new array. */
function patchSegment(
  segments: ActiveTurnSegment[],
  messageId: string,
  patch: (segment: ActiveTurnSegment) => ActiveTurnSegment,
): ActiveTurnSegment[] {
  const index = segments.findIndex(
    (segment) => segment.messageId === messageId,
  );
  if (index === -1) {
    return [
      ...segments,
      patch({ messageId, text: "", thinking: "", toolCalls: [] }),
    ];
  }
  const next = [...segments];
  next[index] = patch(next[index]!);
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
        segments: patchSegment(view.segments, event.messageId, (segment) => ({
          ...segment,
          text: segment.text + event.textDelta,
        })),
        isThinkingLive: false,
      };
    case "thinking-chunk":
      return {
        ...view,
        segments: patchSegment(view.segments, event.messageId, (segment) => ({
          ...segment,
          thinking: segment.thinking + event.thinkingDelta,
        })),
        isThinkingLive: true,
      };
    case "tool-call-started":
    case "tool-call-completed":
      return {
        ...view,
        // A tool-only assistant message never streams text — the tool call's
        // parent id still creates its segment (and the dedupe entry).
        segments: patchSegment(
          view.segments,
          event.toolCall.parentMessageId,
          (segment) => ({
            ...segment,
            toolCalls: upsertToolCall(segment.toolCalls, event.toolCall),
          }),
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
    case "agent-text-chunk":
      return {
        ...view,
        agentActivity: patchAgentActivity(
          view.agentActivity,
          event.parentToolUseId,
          (entry) => ({ ...entry, text: entry.text + event.textDelta }),
        ),
      };
    case "agent-tool-started":
      return {
        ...view,
        agentActivity: patchAgentActivity(
          view.agentActivity,
          event.parentToolUseId,
          (entry) => ({
            ...entry,
            toolCalls: [
              ...entry.toolCalls,
              {
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                toolInput: event.toolInput,
                toolOutput: null,
                status: "started",
                startedAt: event.startedAt,
                completedAt: null,
              },
            ],
          }),
        ),
      };
    case "agent-tool-completed":
      return {
        ...view,
        agentActivity: patchAgentActivity(
          view.agentActivity,
          event.parentToolUseId,
          (entry) => ({
            ...entry,
            toolCalls: entry.toolCalls.map((call) =>
              call.toolUseId === event.toolUseId
                ? {
                    ...call,
                    toolOutput: event.toolOutput,
                    status: event.isError ? ("failed" as const) : ("completed" as const),
                    completedAt: event.completedAt,
                  }
                : call,
            ),
          }),
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
