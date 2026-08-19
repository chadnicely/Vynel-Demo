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
    expect(presentation.stats).toBeNull();
    expect(presentation.body).toEqual({
      kind: "code",
      code: "export const x = 1",
      language: "typescript",
      startLine: 5,
    });
  });

  it("presents Edit as a unified diff with line stats", () => {
    const presentation = presentToolCall(
      makeToolCall("Edit", {
        file_path: "site\\pricing.md",
        old_string: "Pro — $39/mo",
        new_string: "Pro — $49/mo\nTeam — $99/mo",
      }),
    );

    expect(presentation.verb).toBe("Edited");
    expect(presentation.argument).toBe("pricing.md");
    expect(presentation.stats).toEqual({ added: 2, removed: 1 });
    expect(presentation.body).toEqual({
      kind: "diff",
      language: "markdown",
      removed: "Pro — $39/mo",
      added: "Pro — $49/mo\nTeam — $99/mo",
    });
  });

  it("presents Write as all-added with the +N stat (a trailing newline is not a line)", () => {
    const presentation = presentToolCall(
      makeToolCall("Write", {
        file_path: "notes.md",
        content: "line one\nline two\nline three\n",
      }),
    );

    expect(presentation.verb).toBe("Wrote");
    expect(presentation.stats).toEqual({ added: 3, removed: 0 });
    expect(presentation.body).toEqual({
      kind: "diff",
      language: "markdown",
      removed: "",
      added: "line one\nline two\nline three\n",
    });
  });

  it("presents Bash as a terminal block with the command as argument", () => {
    const presentation = presentToolCall(
      makeToolCall("Bash", { command: "npm run build" }, "✓ built in 1.9s"),
    );

    expect(presentation.verb).toBe("Ran");
    expect(presentation.argument).toBe("npm run build");
    expect(presentation.body).toEqual({
      kind: "terminal",
      command: "npm run build",
      output: "✓ built in 1.9s",
    });
  });

  it("presents WebSearch by its query", () => {
    const presentation = presentToolCall(
      makeToolCall("WebSearch", { query: "dhaka traffic now" }, "results…"),
    );

    expect(presentation.verb).toBe("Searched the web");
    expect(presentation.argument).toBe("dhaka traffic now");
    expect(presentation.body).toEqual({ kind: "text", text: "results…" });
  });

  it("presents speak as its spoken text even though it returns an ack", () => {
    const presentation = presentToolCall(
      makeToolCall(
        "mcp__vynel__speak",
        { text: "Hello Chad." },
        [{ type: "text", text: '{"spoken":true}' }],
      ),
    );

    expect(presentation.verb).toBe("speak");
    expect(presentation.body).toEqual({ kind: "text", text: "Hello Chad." });
  });

  it("presents a single-string-input tool as that text when it returned nothing", () => {
    const presentation = presentToolCall(
      makeToolCall("mcp__vynel__announce", { message: "Build done." }, null),
    );

    expect(presentation.body).toEqual({ kind: "text", text: "Build done." });
  });

  it("keeps the payload panes when a single-string-input tool returned a result", () => {
    const presentation = presentToolCall(
      makeToolCall("mcp__vynel__lookup", { term: "invoices" }, { rows: 4 }),
    );

    expect(presentation.body.kind).toBe("payloads");
  });

  it("humanizes MCP tool names and falls back to payload panes", () => {
    const unknownTool = presentToolCall(
      makeToolCall(
        "mcp__vynel__search_knowledge",
        { query: "x", limit: 5 },
        { hits: [] },
      ),
    );
    const malformedRead = presentToolCall(
      makeToolCall("Read", "not-an-object"),
    );

    expect(unknownTool.verb).toBe("search knowledge");
    expect(unknownTool.body.kind).toBe("payloads");
    expect(malformedRead.body.kind).toBe("payloads");
  });

  it("shows a BLOCKED call's refusal message as the output — what the model got back, not the record", () => {
    const presentation = presentToolCall({
      ...makeToolCall(
        "Bash",
        { command: 'ssh ops@host "crontab -"' },
        { blockedBy: "classifier", reason: "no clear intent", message: "STOP and wait." },
      ),
      status: "blocked",
      isErrorResult: true,
    });

    expect(presentation.body).toEqual({
      kind: "terminal",
      command: 'ssh ops@host "crontab -"',
      output: "STOP and wait.",
    });
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

  it("labels groups in plain language, humanizing MCP names", () => {
    expect(describeToolCallGroup("Read", 2)).toBe("Read 2 files");
    expect(describeToolCallGroup("Bash", 1)).toBe("Ran 1 command");
    expect(describeToolCallGroup("mcp__vynel__speak", 2)).toBe(
      "speak 2 calls",
    );
    expect(describeToolCallGroup("my-custom-tool", 3)).toBe(
      "my-custom-tool 3 calls",
    );
  });
});
