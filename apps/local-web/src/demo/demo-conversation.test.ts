import { describe, expect, it } from "vitest";
import {
  DEMO_CONVERSATION_REPLIES,
  demoReplyLines,
  isClosingRequest,
} from "./demo-conversation.js";

describe("isClosingRequest", () => {
  it("hears the sign-off however he words it", () => {
    expect(isClosingRequest("Thanks Pacino!")).toBe(true);
    expect(isClosingRequest("thank you pacino")).toBe(true);
    expect(isClosingRequest("appreciate it man")).toBe(true);
  });

  it("does not end the show on the other two exchanges", () => {
    expect(isClosingRequest("Hey Pacino what's up")).toBe(false);
    expect(isClosingRequest("How we looking on software")).toBe(false);
    expect(isClosingRequest("what's our update today")).toBe(false);
    expect(isClosingRequest("")).toBe(false);
  });
});

describe("demoReplyLines", () => {
  it("hands the recording pass every reply, exactly as spoken", () => {
    expect(demoReplyLines()).toEqual([
      DEMO_CONVERSATION_REPLIES.opening,
      DEMO_CONVERSATION_REPLIES.software,
      DEMO_CONVERSATION_REPLIES.closing,
    ]);
  });
});
