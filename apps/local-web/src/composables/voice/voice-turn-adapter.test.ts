import { describe, expect, it } from "vitest";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { VoiceTurnEvent } from "./voice-command-session.js";
import {
  adaptChatTurnStreamToVoice,
  SPEAK_TOOL_NAME,
} from "./voice-turn-adapter.js";

// The adapter is the voice session's whole read of a brain turn: the streamed
// text IS the voice (voice-realtime VR1) — spoken per sentence as the deltas
// arrive, never waiting for the stream to end — plus the session identity the
// barge-in interrupt needs, and the speak-tool relay other producers still use.

function toolCallStarted(toolName: string, toolInput: unknown): ChatTurnEvent {
  return {
    kind: "tool-call-started",
    toolCall: {
      id: "call-1",
      parentMessageId: "msg-1",
      toolUseId: "toolu-1",
      toolName,
      toolInput,
      toolOutput: null,
      status: "started",
      approvalStatus: null,
      isErrorResult: false,
      subagentNarrative: null,
      subagentToolCalls: null,
      startedAt: "2026-07-21T00:00:00.000Z",
      completedAt: null,
    },
  } as ChatTurnEvent;
}

function textChunk(textDelta: string): ChatTurnEvent {
  return { kind: "text-chunk", messageId: "msg-1", textDelta };
}

const userPersisted = (sessionId: string): ChatTurnEvent =>
  ({
    kind: "user-message-persisted",
    message: { id: "u-1", sessionId, role: "user", body: "hi" },
  }) as unknown as ChatTurnEvent;

const ended = { kind: "turn-stream-ended" } as ChatTurnEvent;

async function* scripted(events: ChatTurnEvent[]): AsyncIterable<ChatTurnEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

async function collect(events: ChatTurnEvent[]): Promise<VoiceTurnEvent[]> {
  const out: VoiceTurnEvent[] = [];
  for await (const event of adaptChatTurnStreamToVoice(scripted(events))) out.push(event);
  return out;
}

describe("adaptChatTurnStreamToVoice", () => {
  it("speaks the streamed text one sentence at a time and flushes the tail at the end", async () => {
    const events = await collect([
      textChunk("It's 26 degrees "),
      textChunk("and clear. Get some "),
      textChunk("rest"),
      ended,
    ]);
    expect(events).toEqual([
      { kind: "spoke", text: "It's 26 degrees and clear." },
      { kind: "spoke", text: "Get some rest" },
      { kind: "completed" },
    ]);
  });

  it("yields the first sentence BEFORE the stream ends (the reply starts sounding mid-generation)", async () => {
    const pulled: string[] = [];
    async function* source(): AsyncIterable<ChatTurnEvent> {
      pulled.push("chunk-1");
      yield textChunk("First sentence. Second ");
      pulled.push("chunk-2");
      yield textChunk("sentence.");
      pulled.push("ended");
      yield ended;
    }
    const seen: string[] = [];
    for await (const event of adaptChatTurnStreamToVoice(source())) {
      if (event.kind === "spoke") seen.push(`${event.text}|after:${pulled.at(-1)}`);
    }
    // "First sentence." was spoken while the source had only produced chunk 1.
    expect(seen[0]).toBe("First sentence.|after:chunk-1");
    expect(seen[1]).toBe("Second sentence.|after:ended");
  });

  it("names the turn's session from user-message-persisted and session-created", async () => {
    const events = await collect([
      userPersisted("sess-voice-1"),
      {
        kind: "session-created",
        session: { id: "sess-voice-2" },
      } as unknown as ChatTurnEvent,
      ended,
    ]);
    expect(events).toEqual([
      { kind: "session", sessionId: "sess-voice-1" },
      { kind: "session", sessionId: "sess-voice-2" },
      { kind: "completed" },
    ]);
  });

  it("still surfaces a speak-tool relay (another producer speaking through the tool)", async () => {
    const events = await collect([
      toolCallStarted(SPEAK_TOOL_NAME, { text: "It is two in the morning." }),
      ended,
    ]);
    expect(events).toEqual([
      { kind: "spoke", text: "It is two in the morning." },
      { kind: "completed" },
    ]);
  });

  it("stays silent on a no-speak, no-text turn (nothing worth reading aloud)", async () => {
    const events = await collect([
      toolCallStarted("mcp__vynel__send_task_to_workspace", { task: "check things" }),
      ended,
    ]);
    expect(events).toEqual([{ kind: "completed" }]);
  });

  it("maps an errored session to failed and stops reading", async () => {
    const events = await collect([
      textChunk("Partial answer. Before the crash"),
      { kind: "session-errored", errorMessage: "provider exploded" } as ChatTurnEvent,
      textChunk("never seen"),
    ]);
    expect(events).toEqual([
      { kind: "spoke", text: "Partial answer." },
      { kind: "failed", message: "provider exploded" },
    ]);
  });

  it("maps a session interrupted from elsewhere to a quiet end (no failure line)", async () => {
    const events = await collect([
      textChunk("Halfway. Through the"),
      { kind: "session-interrupted", sessionId: "s" } as ChatTurnEvent,
    ]);
    expect(events).toEqual([{ kind: "spoke", text: "Halfway." }, { kind: "interrupted" }]);
  });

  it("ignores a speak call with a blank text input", async () => {
    const events = await collect([toolCallStarted(SPEAK_TOOL_NAME, { text: "   " }), ended]);
    expect(events).toEqual([{ kind: "completed" }]);
  });
});
