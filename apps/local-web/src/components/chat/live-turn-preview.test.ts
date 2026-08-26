import { describe, it, expect } from "vitest";
import { deriveLivePreview } from "./live-turn-preview.js";
import { createActiveTurnView } from "../../composables/chat/active-turn-view.js";
import type {
  ActiveTurnSegment,
  ActiveTurnView,
} from "../../composables/chat/active-turn-view.js";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";

function toolCall(overrides: Partial<ChatToolCallResponse> = {}): ChatToolCallResponse {
  return {
    id: "tc-1",
    toolUseId: "tu-1",
    toolName: "Read",
    toolInput: { file_path: "/dev/shop/package.json" },
    toolOutput: null,
    status: "completed",
    ...overrides,
  } as ChatToolCallResponse;
}

function segment(overrides: Partial<ActiveTurnSegment> = {}): ActiveTurnSegment {
  return { messageId: "m1", text: "", thinking: "", toolCalls: [], ...overrides };
}

function viewWith(overrides: Partial<ActiveTurnView>): ActiveTurnView {
  return { ...createActiveTurnView(), ...overrides };
}

describe("deriveLivePreview", () => {
  it("names the newest tool call as a short sentence", () => {
    const view = viewWith({ segments: [segment({ toolCalls: [toolCall()] })] });
    expect(deriveLivePreview(view)).toBe("Read package.json");
  });

  it("prefers the NEWEST tool call in the newest segment", () => {
    const view = viewWith({
      segments: [
        segment({
          toolCalls: [
            toolCall({ toolName: "Read", toolInput: { file_path: "/a/one.ts" } }),
            toolCall({ toolName: "Read", toolInput: { file_path: "/a/two.ts" } }),
          ],
        }),
      ],
    });
    expect(deriveLivePreview(view)).toBe("Read two.ts");
  });

  it("falls back to the first line of the answer typing in, markdown stripped", () => {
    const view = viewWith({
      segments: [segment({ text: "## Here is the plan\n\nmore below" })],
    });
    expect(deriveLivePreview(view)).toBe("Here is the plan");
  });

  it("falls back to the first line of thinking when there is no text or tool yet", () => {
    const view = viewWith({ segments: [segment({ thinking: "Let me check the files" })] });
    expect(deriveLivePreview(view)).toBe("Let me check the files");
  });

  it("says Thinking… while thinking is live and nothing else has landed", () => {
    expect(deriveLivePreview(viewWith({ segments: [], isThinkingLive: true }))).toBe("Thinking…");
  });

  it("says Working… at the very start of a turn", () => {
    expect(deriveLivePreview(viewWith({ segments: [] }))).toBe("Working…");
  });
});
