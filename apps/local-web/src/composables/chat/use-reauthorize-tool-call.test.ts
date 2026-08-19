import { describe, expect, it, vi } from "vitest";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { useReauthorizeToolCall } from "./use-reauthorize-tool-call.js";

const blockedCall: ChatToolCallResponse = {
  id: "tc-1",
  parentMessageId: "m-1",
  toolUseId: "tu-1",
  toolName: "Bash",
  toolInput: { command: "crontab -" },
  toolOutput: { blockedBy: "classifier", reason: "no clear intent", message: "STOP" },
  status: "blocked",
  approvalStatus: null,
  isErrorResult: true,
  startedAt: "2026-08-19T10:00:00.000Z",
  completedAt: "2026-08-19T10:00:01.000Z",
};

describe("useReauthorizeToolCall", () => {
  it("sends the explicit approval through the bound composer, naming the tool the model knows", () => {
    const { composer, reauthorizeToolCall } = useReauthorizeToolCall();
    const sendText = vi.fn();
    composer.value = { sendText };

    reauthorizeToolCall(blockedCall);

    expect(sendText).toHaveBeenCalledWith(
      "Approved — go ahead and run Bash exactly as proposed.",
    );
  });

  it("is a no-op before the composer mounts (nothing to send through)", () => {
    const { reauthorizeToolCall } = useReauthorizeToolCall();
    expect(() => reauthorizeToolCall(blockedCall)).not.toThrow();
  });
});
