import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { ThinkingEffortLevel } from "@vynel/contracts/chat/thinking-effort";
import type { SessionMode } from "@vynel/session";
import { SdkError, type VynelClient } from "@vynel/sdk";
import type { SessionScope } from "./session-scope.js";
import type { TurnAttachmentInput } from "./turn-attachments.js";
import {
  frameToChatTurnEvent,
  parseSseFrame,
  splitSseFrames,
  type SseFrame,
} from "./sse-frames.js";

// The real live-turn transport. The generated `startTurn` methods buffer the
// whole body (openapi-fetch resolves + parses before returning), so they can't
// stream — we call the typed path-keyed `POST` with `parseAs: 'stream'` instead,
// keeping the request typing, the `/api` baseUrl, and any middleware, and read
// the SSE body ourselves via the pure decoder in `sse-frames`.

export interface StartTurnInput {
  scope: SessionScope;
  userMessageText: string;
  /** Files/images riding this turn (already base64-encoded). Both scopes. */
  attachments?: TurnAttachmentInput[];
  /** The Claude model to run this turn (a CHAT_MODEL_IDS value). Both scopes. */
  model?: string;
  /** Resume this specific SDK session (a history pick). Workspace scope only. */
  resumeSessionId?: string;
  /** Run on the workspace's continuing primary conversation. Workspace scope only. */
  continueRoot?: boolean;
  /** The user-facing session mode (approval behavior). Both scopes — a global turn's
   *  mode also governs any delegation the brain enqueues (surface-up step 1). */
  mode?: SessionMode;
  /** The composer's thinking-effort pick. Both scopes; omitted = Auto (the
   *  provider's adaptive default — today's behavior, byte-for-byte). */
  thinkingEffort?: ThinkingEffortLevel;
  /** The composer's Auto-buildout toggle — write-through persistence only
   *  (rides the turn so a NEW conversation's first turn stamps its row). */
  autoBuildout?: boolean;
  /** This turn came in by VOICE — the brain answers short + spoken (global scope). */
  voice?: boolean;
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
            ...(input.attachments?.length
              ? { attachedImages: input.attachments }
              : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.mode ? { mode: input.mode } : {}),
            ...(input.thinkingEffort
              ? { thinkingEffort: input.thinkingEffort }
              : {}),
            ...(input.autoBuildout !== undefined
              ? { autoBuildout: input.autoBuildout }
              : {}),
            ...(input.voice ? { voice: true } : {}),
          },
          parseAs: "stream",
          signal: input.signal,
        })
      : await client.POST("/workspaces/{workspaceId}/chat/sessions/turn", {
          params: { path: { workspaceId: input.scope.workspaceId } },
          body: {
            userMessageText: input.userMessageText,
            ...(input.attachments?.length
              ? { attachedImages: input.attachments }
              : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.continueRoot ? { continueRoot: true } : {}),
            ...(input.resumeSessionId
              ? { resumeSessionId: input.resumeSessionId }
              : {}),
            ...(input.mode ? { mode: input.mode } : {}),
            ...(input.thinkingEffort
              ? { thinkingEffort: input.thinkingEffort }
              : {}),
            ...(input.autoBuildout !== undefined
              ? { autoBuildout: input.autoBuildout }
              : {}),
          },
          parseAs: "stream",
          signal: input.signal,
        });

  if (!response.ok || !data) throw new SdkError(response, undefined);
  yield* readChatTurnEvents(data);
}

/** Drive a raw SSE ReadableStream through the pure frame decoder — the shared
 *  reader loop. The chat-turn and activity-feed streams both ride this; each
 *  maps the decoded frames into its own event vocabulary. */
export async function* readSseFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
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
      for (const frame of frames) yield parseSseFrame(frame);
    }
    // Flush the decoder — a multi-byte sequence truncated at EOF would
    // otherwise be silently dropped.
    buffer += decoder.decode();
    // A final frame with no trailing blank line (EOF-terminated) still counts.
    const tail = buffer.trim();
    if (tail) yield parseSseFrame(tail);
  } finally {
    reader.releaseLock();
  }
}

/** The chat-turn event stream. Shared with the activity monitor's live
 *  streams (use-activity-monitor) — one reader, one decoder. */
export async function* readChatTurnEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatTurnEvent> {
  for await (const frame of readSseFrames(stream)) {
    const event = frameToChatTurnEvent(frame);
    if (event !== null) yield event;
  }
}
