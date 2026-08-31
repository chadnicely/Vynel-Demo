import { describe, expect, it } from "vitest";
import {
  conversationLines,
  writeConversation,
  FALLBACK_CONVERSATION,
} from "./demo-conversation.js";
import type { DemoScriptLine } from "./demo-script-writer.js";

const PRODUCTS = ["Mintbird", "Quizforma", "Letterman"];

function take(money: boolean): DemoScriptLine[] {
  return [
    {
      text: money ? "Sales came in at $1,508 today." : "Every build is green.",
      projectId: null,
      surface: "hud",
      sourceUpdate: null,
    },
    {
      text: "Mintbird — the new release is in.",
      projectId: "mintbird",
      surface: "nodes",
      sourceUpdate: null,
    },
  ];
}

describe("writeConversation", () => {
  it("writes all four beats", () => {
    const talk = writeConversation(take(true), PRODUCTS, "seed-1");
    expect(conversationLines(talk)).toHaveLength(4);
    for (const line of conversationLines(talk)) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("opens by OFFERING, not by reporting", () => {
    // The take used to launch into the report; it has to ask first.
    const talk = writeConversation(take(true), PRODUCTS, "seed-2");
    expect(talk.opening.endsWith("?")).toBe(true);
  });

  it("never claims money on a take that has none", () => {
    for (let i = 0; i < 40; i += 1) {
      const talk = writeConversation(take(false), PRODUCTS, `dry-${i}`);
      expect(talk.opening.toLowerCase()).not.toMatch(
        /sales|revenue|takings|money|numbers are up/,
      );
    }
  });

  it("names the take's own software in the dev hand-off", () => {
    const talk = writeConversation(take(true), PRODUCTS, "seed-3");
    expect(talk.software.includes("Mintbird") || talk.software.includes("Suite")).toBe(
      true,
    );
  });

  it("films the same take the same way twice", () => {
    const a = writeConversation(take(true), PRODUCTS, "stable");
    const b = writeConversation(take(true), PRODUCTS, "stable");
    expect(b).toEqual(a);
  });

  it("gives a hundred takes a hundred different openings", () => {
    const used = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const talk = writeConversation(take(i % 3 !== 0), PRODUCTS, `take-${i}`, used);
      used.add(talk.opening);
    }
    expect(used.size).toBe(100);
  });

  it("leaves a take written before conversations with something to say", () => {
    expect(conversationLines(FALLBACK_CONVERSATION)).toHaveLength(4);
  });
});
