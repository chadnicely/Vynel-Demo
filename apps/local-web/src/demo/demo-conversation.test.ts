import { describe, expect, it } from "vitest";
import {
  DEMO_CONVERSATION_REPLIES,
  demoReplyLines,
} from "./demo-conversation.js";

describe("demoReplyLines", () => {
  it("hands the recording pass every reply, exactly as spoken", () => {
    expect(demoReplyLines()).toEqual([
      DEMO_CONVERSATION_REPLIES.opening,
      DEMO_CONVERSATION_REPLIES.software,
      DEMO_CONVERSATION_REPLIES.closing,
    ]);
  });
});
