import type {
  ChatSessionDetailResponse,
  ChatSessionResponse,
} from "@vynel/contracts/chat/chat-http";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import type { VynelClient } from "@vynel/sdk";
import type { SessionScope } from "../composables/chat/session-scope.js";
import { DEMO_GLOBAL_ROOT_WORKSPACE_ID, demoStore } from "./demo-store.js";

// THE SWAP SEAM. Hand-written namespaces for surfaces whose HTTP routes don't
// exist yet (workspaces CRUD, chat reads — Slice-3). Method names follow the
// house `x-sdk-name` conventions, so when the real routes land: run
// `pnpm api:generate`, delete this file (and src/demo/), and the composables
// keep working against the generated namespaces unchanged.
// (Precedent: letterman merges its hand-written streaming namespace into the
// generated client the same way.)

export interface DemoWorkspacesNamespace {
  list(): Promise<{ workspaces: WorkspaceResponse[] }>;
}

export interface DemoChatNamespace {
  listSessions(
    scope: SessionScope,
  ): Promise<{ sessions: ChatSessionResponse[] }>;
  getSessionDetail(sessionId: string): Promise<ChatSessionDetailResponse>;
}

export interface DemoNamespaces {
  workspaces: DemoWorkspacesNamespace;
  chat: DemoChatNamespace;
}

export type LocalVynelClient = VynelClient & DemoNamespaces;

/** Keeps the demo honest — loading states must be real, just quick. */
const DEMO_LATENCY_MS = 150;

function withLatency<T>(value: T): Promise<T> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(value), DEMO_LATENCY_MS),
  );
}

export function attachDemoNamespaces(client: VynelClient): LocalVynelClient {
  const workspaces: DemoWorkspacesNamespace = {
    list: () => withLatency({ workspaces: demoStore.listWorkspaces() }),
  };

  const chat: DemoChatNamespace = {
    listSessions: (scope) => {
      const workspaceId =
        scope.kind === "global"
          ? DEMO_GLOBAL_ROOT_WORKSPACE_ID
          : scope.workspaceId;
      return withLatency({ sessions: demoStore.listSessions(workspaceId) });
    },
    getSessionDetail: async (sessionId) => {
      const detail = demoStore.getSessionDetail(sessionId);
      if (!detail) {
        throw new Error(
          `Demo session not found: ${sessionId}. It may have been recreated on reload.`,
        );
      }
      return withLatency(detail);
    },
  };

  return Object.assign(client, { workspaces, chat });
}
