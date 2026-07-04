import { describe, expect, it } from "vitest";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import {
  describeToolCallGroup,
  languageForFilePath,
  presentToolCall,
} from "./tool-presenters.js";
import { groupConsecutiveToolCalls } from "./group-tool-calls.js";

function makeToolCall(
  toolName: string,
  toolInput: unknown,
  toolOutput: unknown = null,
): ChatToolCallResponse {
  return {
    id: `tc-${toolName}-${Math.abs(JSON.stringify(toolInput).length)}`,
    parentMessageId: "m1",
    toolUseId: "tu-1",
    toolName,
    toolInput,
    toolOutput,
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    startedAt: "2026-07-05T10:00:00.000Z",
    completedAt: "2026-07-05T10:00:01.000Z",
  };
}

describe("presentToolCall", () => {
  it("presents Read as highlighted file content with the basename as argument", () => {
    const presentation = presentToolCall(
      makeToolCall(
        "Read",
        { file_path: "src/engine/weapon-map.service.ts", offset: 5 },
        "export const x = 1",
      ),
    );

    expect(presentation.verb).toBe("Read");
    expect(presentation.argument).toBe("weapon-map.service.ts");
    expect(presentation.subtitle).toBe("src/engine/weapon-map.service.ts");
    expect(presentation.body).toEqual({
      kind: "code",
      code: "export const x = 1",
      language: "typescript",
      startLine: 5,
    });
  });

  it("presents Edit as a diff of old and new strings", () => {
    const presentation = presentToolCall(
      makeToolCall("Edit", {
        file_path: "site\\pricing.md",
        old_string: "Pro — $39/mo",
        new_string: "Pro — $49/mo",
      }),
    );

    expect(presentation.argument).toBe("pricing.md");
    expect(presentation.body).toEqual({
      kind: "diff",
      language: "markdown",
      removed: "Pro — $39/mo",
      added: "Pro — $49/mo",
    });
  });

  it("presents Bash as a terminal block with the command as argument", () => {
    const presentation = presentToolCall(
      makeToolCall("Bash", { command: "npm run build" }, "✓ built in 1.9s"),
    );

    expect(presentation.verb).toBe("Bash");
    expect(presentation.argument).toBe("npm run build");
    expect(presentation.body).toEqual({
      kind: "terminal",
      command: "npm run build",
      output: "✓ built in 1.9s",
    });
  });

  it("falls back to payload panes for unknown tools and malformed input", () => {
    const unknownTool = presentToolCall(
      makeToolCall(
        "mcp__vynel__search_knowledge",
        { query: "x" },
        { hits: [] },
      ),
    );
    const malformedRead = presentToolCall(
      makeToolCall("Read", "not-an-object"),
    );

    expect(unknownTool.body.kind).toBe("payloads");
    expect(malformedRead.body.kind).toBe("payloads");
  });
});

describe("languageForFilePath", () => {
  it("maps extensions and defaults to text", () => {
    expect(languageForFilePath("a/b/c.vue")).toBe("vue");
    expect(languageForFilePath("script.SH")).toBe("bash");
    expect(languageForFilePath("notes.unknownext")).toBe("text");
  });
});

describe("groupConsecutiveToolCalls + describeToolCallGroup", () => {
  it("groups consecutive same-tool runs, preserving order", () => {
    const calls = [
      makeToolCall("Read", { file_path: "a.ts" }),
      makeToolCall("Read", { file_path: "b.ts" }),
      makeToolCall("Bash", { command: "ls" }),
      makeToolCall("Read", { file_path: "c.ts" }),
    ];

    const groups = groupConsecutiveToolCalls(calls);

    expect(groups.map((group) => group.map((c) => c.toolName))).toEqual([
      ["Read", "Read"],
      ["Bash"],
      ["Read"],
    ]);
  });

  it("labels groups in plain language", () => {
    expect(describeToolCallGroup("Read", 2)).toBe("Read 2 files");
    expect(describeToolCallGroup("Bash", 1)).toBe("Bash 1 command");
    expect(describeToolCallGroup("my-custom-tool", 3)).toBe(
      "my-custom-tool 3 calls",
    );
  });
});
