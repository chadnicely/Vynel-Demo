import { describe, expect, it } from "vitest";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { VoiceTurnEvent } from "./voice-command-session.js";
import {
  adaptChatTurnStreamToVoice,
  SPEAK_TOOL_NAME,
} from "./voice-turn-adapter.js";

// The adapter is the voice session's whole read of a brain turn — especially
// the safety net: a turn that never called `speak` must still speak the gist
// of its text answer instead of ending in silence (the long-session
// instruction-decay failure observed live).

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
  it("surfaces each speak call and completes without a fallback", async () => {
    const events = await collect([
      toolCallStarted(SPEAK_TOOL_NAME, { text: "It is two in the morning." }),
      textChunk("Done. ✅"),
      { kind: "turn-stream-ended" } as ChatTurnEvent,
    ]);
    expect(events).toEqual([
      { kind: "spoke", text: "It is two in the morning." },
      { kind: "completed" },
    ]);
  });

  it("speaks the gist of the text answer when the turn never called speak", async () => {
    const events = await collect([
      textChunk("It's **1:59 AM** (BST). "),
      textChunk("Get some rest if you can."),
      { kind: "turn-stream-ended" } as ChatTurnEvent,
    ]);
    expect(events).toEqual([
      { kind: "spoke", text: "It's 1:59 AM (BST)." },
      { kind: "completed" },
    ]);
  });

  it("stays silent on a no-speak, no-text turn (nothing worth reading aloud)", async () => {
    const events = await collect([
      toolCallStarted("mcp__vynel__route_to_workspace", { task: "check things" }),
      { kind: "turn-stream-ended" } as ChatTurnEvent,
    ]);
    expect(events).toEqual([{ kind: "completed" }]);
  });

  it("maps an errored session to failed and never falls back over it", async () => {
    const events = await collect([
      textChunk("Partial answer before the crash."),
      { kind: "session-errored", errorMessage: "provider exploded" } as ChatTurnEvent,
    ]);
    expect(events).toEqual([{ kind: "failed", message: "provider exploded" }]);
  });

  it("ignores a speak call with a blank text input", async () => {
    const events = await collect([
      toolCallStarted(SPEAK_TOOL_NAME, { text: "   " }),
      { kind: "turn-stream-ended" } as ChatTurnEvent,
    ]);
    expect(events).toEqual([{ kind: "completed" }]);
  });
});
