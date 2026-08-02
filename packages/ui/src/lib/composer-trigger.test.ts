import { describe, expect, it } from "vitest";
import {
  applyComposerSuggestion,
  detectComposerTrigger,
} from "./composer-trigger.js";

function caretAtEnd(text: string) {
  return detectComposerTrigger(text, text.length);
}

describe("detectComposerTrigger — @", () => {
  it("opens on the bare trigger (empty query — the mention-picker rule)", () => {
    expect(caretAtEnd("@")).toEqual({ trigger: "@", query: "", start: 0 });
    expect(caretAtEnd("hello @")).toEqual({ trigger: "@", query: "", start: 6 });
  });

  it("carries the typed filter as the query", () => {
    expect(caretAtEnd("hey @cod")).toEqual({ trigger: "@", query: "cod", start: 4 });
    expect(caretAtEnd("@Sar")).toEqual({ trigger: "@", query: "Sar", start: 0 });
  });

  it("requires a word boundary — emails never trigger", () => {
    expect(caretAtEnd("chad@acme")).toBeNull();
  });

  it("closes when the token is left (whitespace or charset break)", () => {
    expect(caretAtEnd("@sarah done ")).toBeNull();
    expect(caretAtEnd("@sarah,")).toBeNull();
  });

  it("follows the caret, not the end of text", () => {
    const text = "@sar later text";
    expect(detectComposerTrigger(text, 4)).toEqual({ trigger: "@", query: "sar", start: 0 });
    expect(detectComposerTrigger(text, text.length)).toBeNull();
  });
});

describe("detectComposerTrigger — #", () => {
  it("opens bare and with a simple query", () => {
    expect(caretAtEnd("#")).toEqual({ trigger: "#", query: "", start: 0 });
    expect(caretAtEnd("see #vyn")).toEqual({ trigger: "#", query: "vyn", start: 4 });
  });

  it("the open-quoted form keeps the picker open across spaces", () => {
    expect(caretAtEnd('#"')).toEqual({ trigger: "#", query: "", start: 0 });
    expect(caretAtEnd('look at #"Q3 pl')).toEqual({
      trigger: "#",
      query: "Q3 pl",
      start: 8,
    });
  });

  it("a closed quote ends the context; mid-word # never opens", () => {
    expect(caretAtEnd('#"Q3 plans"')).toBeNull();
    expect(caretAtEnd("issue#42")).toBeNull();
  });
});

describe("detectComposerTrigger — /", () => {
  it("opens at the message start only (Claude Code semantics)", () => {
    expect(caretAtEnd("/")).toEqual({ trigger: "/", query: "", start: 0 });
    expect(caretAtEnd("/dep")).toEqual({ trigger: "/", query: "dep", start: 0 });
    expect(caretAtEnd("  /st")).toEqual({ trigger: "/", query: "st", start: 2 });
    expect(caretAtEnd("run /deploy")).toBeNull();
  });

  it("supports namespaced commands and closes after the token", () => {
    expect(caretAtEnd("/git:com")).toEqual({ trigger: "/", query: "git:com", start: 0 });
    expect(caretAtEnd("/deploy now")).toBeNull();
  });
});

describe("applyComposerSuggestion", () => {
  it("replaces the open token with the insert + a trailing space", () => {
    const context = { trigger: "@" as const, query: "cod", start: 4 };
    const applied = applyComposerSuggestion("hey @cod", context, 8, "@code-reviewer");
    expect(applied.text).toBe("hey @code-reviewer ");
    expect(applied.caretIndex).toBe(19);
  });

  it("preserves text after the caret", () => {
    const context = { trigger: "#" as const, query: "Q3 pl", start: 8 };
    const applied = applyComposerSuggestion(
      'look at #"Q3 pl and more',
      context,
      15,
      '#"Q3 plans"',
    );
    expect(applied.text).toBe('look at #"Q3 plans"  and more');
    expect(applied.caretIndex).toBe(20);
  });
});
