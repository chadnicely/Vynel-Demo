import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { SessionMode } from "@vynel/session";
import { SdkError, type VynelClient } from "@vynel/sdk";
import type { SessionScope } from "./session-scope.js";
import {
  frameToChatTurnEvent,
  parseSseFrame,
  splitSseFrames,
} from "./sse-frames.js";

// The real live-turn transport. The generated `startTurn` methods buffer the
// whole body (openapi-fetch resolves + parses before returning), so they can't
// stream — we call the typed path-keyed `POST` with `parseAs: 'stream'` instead,
// keeping the request typing, the `/api` baseUrl, and any middleware, and read
// the SSE body ourselves via the pure decoder in `sse-frames`.

export interface StartTurnInput {
  scope: SessionScope;
  userMessageText: string;
  /** The Claude model to run this turn (a CHAT_MODEL_IDS value). Both scopes. */
  model?: string;
  /** Resume this specific SDK session (a history pick). Workspace scope only. */
  resumeSessionId?: string;
  /** Run on the workspace's continuing primary conversation. Workspace scope only. */
  continueRoot?: boolean;
  /** The user-facing session mode (approval behavior). Workspace scope only. */
  mode?: SessionMode;
  signal: AbortSignal;
}

/** Open a turn and yield its ChatTurnEvents until the stream ends (or aborts). */
export async function* streamChatTurnEvents(
  client: VynelClient,
  input: StartTurnInput,
): AsyncGenerator<ChatTurnEvent> {
  const { data, response } =
    input.scope.kind === "global"
      ? await client.POST("/root/turn", {
          body: {
            userMessageText: input.userMessageText,
            ...(input.model ? { model: input.model } : {}),
          },
          parseAs: "stream",
          signal: input.signal,
        })
      : await client.POST("/workspaces/{workspaceId}/chat/sessions/turn", {
          params: { path: { workspaceId: input.scope.workspaceId } },
          body: {
            userMessageText: input.userMessageText,
            ...(input.model ? { model: input.model } : {}),
            ...(input.continueRoot ? { continueRoot: true } : {}),
            ...(input.resumeSessionId
              ? { resumeSessionId: input.resumeSessionId }
              : {}),
            ...(input.mode ? { mode: input.mode } : {}),
          },
          parseAs: "stream",
          signal: input.signal,
        });

  if (!response.ok || !data) throw new SdkError(response, undefined);
  yield* readChatTurnEvents(data);
}

/** Drive a raw SSE ReadableStream through the pure frame decoder. */
async function* readChatTurnEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatTurnEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const frame of frames)
        yield frameToChatTurnEvent(parseSseFrame(frame));
    }
    // A final frame with no trailing blank line (EOF-terminated) still counts.
    const tail = buffer.trim();
    if (tail) yield frameToChatTurnEvent(parseSseFrame(tail));
  } finally {
    reader.releaseLock();
  }
}
