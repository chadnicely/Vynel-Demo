import type {
  ChatMessageResponse,
  ChatSessionDetailResponse,
  ChatSessionResponse,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import { demoWorkspaces } from "./fixtures/workspaces.js";
import {
  DEMO_GLOBAL_ROOT_WORKSPACE_ID,
  demoMessagesBySessionId,
  demoSessions,
  demoToolCallsByMessageId,
} from "./fixtures/sessions.js";
import { makeDemoId } from "./demo-ids.js";

export interface DemoTurnResult {
  userMessage: ChatMessageResponse;
  assistantMessage: ChatMessageResponse;
  toolCalls: ChatToolCallResponse[];
}

// The demo world's single source of truth — an in-memory stand-in for the
// local API's database. Namespaces read it; a finished demo turn writes back
// into it, so vue-query's invalidate-and-refetch loop behaves exactly like it
// will against the real API.
export interface DemoStore {
  listWorkspaces(): WorkspaceResponse[];
  listSessions(workspaceId: string): ChatSessionResponse[];
  /** Newest-first across every scope (global + all workspaces) — the dashboard feed. */
  listRecentSessions(limit: number): ChatSessionResponse[];
  getSessionDetail(sessionId: string): ChatSessionDetailResponse | null;
  createSession(workspaceId: string, title: string): ChatSessionResponse;
  appendTurnResult(sessionId: string, result: DemoTurnResult): void;
}

export function createDemoStore(): DemoStore {
  const workspaces = [...demoWorkspaces];
  const sessions = [...demoSessions];
  const messagesBySessionId: Record<string, ChatMessageResponse[]> = {
    ...demoMessagesBySessionId,
  };
  const toolCallsByMessageId: Record<string, ChatToolCallResponse[]> = {
    ...demoToolCallsByMessageId,
  };

  return {
    listWorkspaces() {
      return workspaces;
    },

    listSessions(workspaceId) {
      return sessions
        .filter((session) => session.workspaceId === workspaceId)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    },

    listRecentSessions(limit) {
      return [...sessions]
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
        .slice(0, limit);
    },

    getSessionDetail(sessionId) {
      const session = sessions.find((row) => row.id === sessionId);
      if (!session) return null;
      const messages = messagesBySessionId[sessionId] ?? [];
      const toolCalls: Record<string, ChatToolCallResponse[]> = {};
      for (const message of messages) {
        const calls = toolCallsByMessageId[message.id];
        if (calls) toolCalls[message.id] = calls;
      }
      return { session, messages, toolCallsByMessageId: toolCalls };
    },

    createSession(workspaceId, title) {
      const now = new Date().toISOString();
      const session: ChatSessionResponse = {
        id: makeDemoId("session"),
        userId: "demo-user",
        workspaceId,
        providerId: "claude",
        model: "claude-opus-4-8",
        title,
        isArchived: false,
        visibility: "listed",
        deletedAt: null,
        totalMessageCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        lastMessagePreview: null,
        startedAt: now,
        lastMessageAt: now,
        updatedAt: now,
      };
      sessions.unshift(session);
      messagesBySessionId[session.id] = [];
      return session;
    },

    appendTurnResult(sessionId, result) {
      const session = sessions.find((row) => row.id === sessionId);
      if (!session) return;

      const messages = messagesBySessionId[sessionId] ?? [];
      messages.push(result.userMessage, result.assistantMessage);
      messagesBySessionId[sessionId] = messages;
      if (result.toolCalls.length > 0) {
        toolCallsByMessageId[result.assistantMessage.id] = result.toolCalls;
      }

      const now = new Date().toISOString();
      session.totalMessageCount = messages.length;
      session.lastMessagePreview = result.assistantMessage.body.slice(0, 120);
      session.lastMessageAt = now;
      session.updatedAt = now;
    },
  };
}

/** One demo world per app run (module singleton, mirrors the one real DB). */
export const demoStore = createDemoStore();

export { DEMO_GLOBAL_ROOT_WORKSPACE_ID };
