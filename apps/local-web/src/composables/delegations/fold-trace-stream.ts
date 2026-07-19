// Pure fold: a delegation's live ChatTurnEvents → the Watch panel's overlay
// entries. The stream carries only the live tail (rows persist server-side as
// they stream; the settled trace comes from the fetch) — this materializes the
// SAME entry shape the trace read returns so the panel renders one list.
// Returns a NEW state per event (Vue refs reassign; tests stay value-based).

import type {
  ChatTurnEvent,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";
import type { AgentActivityView } from "../chat/active-turn-view.js";

/** The overlay's entry — the structural subset the panel renders (assignable
 *  from the trace read's wire entries too). */
export interface LiveTraceEntry {
  id: string;
  role: string;
  sourceKind: string | null;
  sourceLabel: string | null;
  body: string;
  toolCalls: ChatToolCallResponse[];
}

export interface LiveTraceState {
  entries: LiveTraceEntry[];
  /** A carded tool waiting on the user's decision — the panel shows a pill. */
  pendingApprovalToolName: string | null;
  /** A spawned subagent's live activity, keyed by its Agent tool call's
   *  toolUseId — the panel nests it under that card, same as the chat thread
   *  (the Phase-3 "watch spawned sub-agents" goal's first slice). */
  agentActivity: Record<string, AgentActivityView>;
}

export function createLiveTraceState(): LiveTraceState {
  return { entries: [], pendingApprovalToolName: null, agentActivity: {} };
}

function patchAgentActivity(
  activity: Record<string, AgentActivityView>,
  parentToolUseId: string,
  patch: (entry: AgentActivityView) => AgentActivityView,
): Record<string, AgentActivityView> {
  const current = activity[parentToolUseId] ?? { text: "", toolCalls: [] };
  return { ...activity, [parentToolUseId]: patch(current) };
}

function upsertEntry(
  entries: LiveTraceEntry[],
  id: string,
  update: (entry: LiveTraceEntry) => LiveTraceEntry,
): LiveTraceEntry[] {
  const existing = entries.find((entry) => entry.id === id);
  if (existing) {
    return entries.map((entry) => (entry.id === id ? update(entry) : entry));
  }
  const created: LiveTraceEntry = {
    id,
    role: "assistant",
    sourceKind: null,
    sourceLabel: null,
    body: "",
    toolCalls: [],
  };
  return [...entries, update(created)];
}

function upsertToolCall(
  toolCalls: ChatToolCallResponse[],
  toolCall: ChatToolCallResponse,
): ChatToolCallResponse[] {
  const exists = toolCalls.some((row) => row.id === toolCall.id);
  return exists
    ? toolCalls.map((row) => (row.id === toolCall.id ? toolCall : row))
    : [...toolCalls, toolCall];
}

export function applyTraceStreamEvent(
  state: LiveTraceState,
  event: ChatTurnEvent,
): LiveTraceState {
  switch (event.kind) {
    case "user-message-persisted":
      // The routed task landing — already attributed by the server.
      return {
        ...state,
        entries: upsertEntry(state.entries, event.message.id, (entry) => ({
          ...entry,
          role: event.message.role,
          sourceKind: event.message.sourceKind ?? null,
          sourceLabel: event.message.sourceLabel ?? null,
          body: event.message.body,
        })),
      };
    case "text-chunk":
      return {
        ...state,
        entries: upsertEntry(state.entries, event.messageId, (entry) => ({
          ...entry,
          body: entry.body + event.textDelta,
        })),
      };
    case "tool-call-started":
    case "tool-call-completed":
      return {
        ...state,
        entries: upsertEntry(
          state.entries,
          event.toolCall.parentMessageId,
          (entry) => ({
            ...entry,
            toolCalls: upsertToolCall(entry.toolCalls, event.toolCall),
          }),
        ),
      };
    case "agent-text-chunk":
      return {
        ...state,
        agentActivity: patchAgentActivity(
          state.agentActivity,
          event.parentToolUseId,
          (entry) => ({ ...entry, text: entry.text + event.textDelta }),
        ),
      };
    case "agent-tool-started":
      return {
        ...state,
        agentActivity: patchAgentActivity(
          state.agentActivity,
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
        ...state,
        agentActivity: patchAgentActivity(
          state.agentActivity,
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
    case "approval-requested":
      return { ...state, pendingApprovalToolName: event.toolName };
    case "approval-resolved":
    case "approval-auto-resolved":
      return { ...state, pendingApprovalToolName: null };
    default:
      // thinking/usage/session lifecycle — not rendered by the panel.
      return state;
  }
}

/** Merge the SETTLED trace (authoritative) with the live overlay: a server row
 *  wins by id; overlay-only rows (still streaming) append in arrival order. */
export function mergeTraceEntries<T extends LiveTraceEntry>(
  settled: T[],
  overlay: LiveTraceEntry[],
): LiveTraceEntry[] {
  const settledIds = new Set(settled.map((entry) => entry.id));
  return [...settled, ...overlay.filter((entry) => !settledIds.has(entry.id))];
}
