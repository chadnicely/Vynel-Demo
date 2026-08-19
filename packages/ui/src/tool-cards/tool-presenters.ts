import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { readBlockedToolOutput } from "@vynel/contracts/chat/blocked-tool-call";
import { presentDesktopToolCall } from "./desktop-step-presenter.js";

// Presentation logic for tool calls — turns a raw {toolName, toolInput,
// toolOutput} row into what a person should SEE: "Wrote pricing.md +12" with
// the file content under a path header, not a JSON dump. Pure functions;
// unknown tools fall back to the generic payload panes.

export type ToolCallBody =
  | { kind: "code"; code: string; language: string; startLine?: number }
  | { kind: "diff"; language: string; removed: string; added: string }
  | { kind: "terminal"; command: string; output: string }
  | { kind: "text"; text: string }
  | { kind: "payloads"; input: unknown; output: unknown };

export interface ToolCallStats {
  added: number;
  removed: number;
}

export interface ToolCallPresentation {
  /** The action word — "Read", "Wrote", "Ran", or the humanized tool name. */
  verb: string;
  /** The human-meaningful argument — a file name, a command, a pattern. */
  argument: string | null;
  /** Fuller context shown as the expanded header — usually the full path. */
  subtitle: string | null;
  /** Added/removed line counts for file-writing tools — the "+29 -3" chip. */
  stats: ToolCallStats | null;
  body: ToolCallBody;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  html: "html",
  vue: "vue",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
};

export function languageForFilePath(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "text";
}

/** An MCP tool id reads as machinery ("mcp__vynel__send_task_to_workspace") —
 *  surface just the tool's own name in words ("send task to workspace"). */
export function displayToolName(toolName: string): string {
  const mcpMatch = toolName.match(/^mcp__.+?__(.+)$/);
  if (!mcpMatch) return toolName;
  return mcpMatch[1]!.replace(/[_-]+/g, " ");
}

function baseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || filePath;
}

function countLines(text: string): number {
  // A trailing newline ends the last line; it doesn't start another.
  const trimmed = text.replace(/\n$/, "");
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

function asDisplayString(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  // A BLOCKED call's output is the refusal record; what came back to the model
  // is its message — the card's blocked line already names who refused and why.
  const blocked = readBlockedToolOutput(payload);
  if (blocked !== null) return blocked.message;
  return JSON.stringify(payload, null, 2);
}

function inputField(input: unknown, field: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function inputNumberField(input: unknown, field: string): number | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

function truncated(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function presentToolCall(
  toolCall: ChatToolCallResponse,
): ToolCallPresentation {
  const { toolName, toolInput, toolOutput } = toolCall;

  // Desktop-control calls read as actions on the user's screen ("Pressed
  // 'Save' in Notepad"), never as raw payload panes — the same grammar the
  // attention overlay narrates with (desktop-step-presenter.ts).
  const desktopPresentation = presentDesktopToolCall(toolName, toolInput, toolOutput);
  if (desktopPresentation !== null) return desktopPresentation;

  const filePath = inputField(toolInput, "file_path");

  if (toolName === "Read" && filePath) {
    return {
      verb: "Read",
      argument: baseName(filePath),
      subtitle: filePath,
      stats: null,
      body: {
        kind: "code",
        code: asDisplayString(toolOutput),
        language: languageForFilePath(filePath),
        startLine: inputNumberField(toolInput, "offset") ?? 1,
      },
    };
  }

  if (toolName === "Write" && filePath) {
    // A Write is all-added — rendered as the added half of a diff so the
    // green gutter and the +N stat read the same as an Edit's.
    const content =
      inputField(toolInput, "content") ?? asDisplayString(toolInput);
    return {
      verb: "Wrote",
      argument: baseName(filePath),
      subtitle: filePath,
      stats: { added: countLines(content), removed: 0 },
      body: {
        kind: "diff",
        language: languageForFilePath(filePath),
        removed: "",
        added: content,
      },
    };
  }

  if (toolName === "Edit" && filePath) {
    const removed = inputField(toolInput, "old_string") ?? "";
    const added = inputField(toolInput, "new_string") ?? "";
    return {
      verb: "Edited",
      argument: baseName(filePath),
      subtitle: filePath,
      stats: { added: countLines(added), removed: countLines(removed) },
      body: {
        kind: "diff",
        language: languageForFilePath(filePath),
        removed,
        added,
      },
    };
  }

  if (toolName === "Bash") {
    const command = inputField(toolInput, "command") ?? "";
    return {
      verb: "Ran",
      argument: command ? truncated(command, 48) : null,
      subtitle: null,
      stats: null,
      body: { kind: "terminal", command, output: asDisplayString(toolOutput) },
    };
  }

  if (toolName === "Grep" || toolName === "Glob") {
    const pattern = inputField(toolInput, "pattern") ?? "";
    return {
      verb: toolName === "Grep" ? "Searched" : "Found",
      argument: pattern || null,
      subtitle: inputField(toolInput, "glob") ?? inputField(toolInput, "path"),
      stats: null,
      body: { kind: "text", text: asDisplayString(toolOutput) },
    };
  }

  if (toolName === "WebSearch") {
    return {
      verb: "Searched the web",
      argument: inputField(toolInput, "query"),
      subtitle: null,
      stats: null,
      body: { kind: "text", text: asDisplayString(toolOutput) },
    };
  }

  if (toolName === "WebFetch") {
    const url = inputField(toolInput, "url");
    return {
      verb: "Fetched",
      argument: url ? truncated(url, 64) : null,
      subtitle: url,
      stats: null,
      body: { kind: "text", text: asDisplayString(toolOutput) },
    };
  }

  // A spawned subagent: name the agent, show the task as the subtitle, and
  // render the result (its final report) as text — never the raw payload pane.
  if (toolName === "Agent" || toolName === "Task") {
    const agentName =
      inputField(toolInput, "name") ??
      inputField(toolInput, "subagent_type") ??
      "agent";
    return {
      verb: "Agent",
      argument: agentName,
      subtitle: inputField(toolInput, "description"),
      stats: null,
      body: { kind: "text", text: asDisplayString(toolOutput) },
    };
  }

  // An unknown tool whose input is a single string field ("speak" → {text})
  // reads best as that text itself — when the result adds nothing: either the
  // tool returned no output, or it's `speak`, whose result is always a
  // boilerplate `{"spoken":true}` ack (the spoken text IS the artifact).
  const soleStringInput = soleStringField(toolInput);
  const isSpeak = displayToolName(toolName) === "speak";
  if (soleStringInput !== null && (isSpeak || isEmptyOutput(toolOutput))) {
    return {
      verb: displayToolName(toolName),
      argument: null,
      subtitle: null,
      stats: null,
      body: { kind: "text", text: soleStringInput },
    };
  }

  return {
    verb: displayToolName(toolName),
    argument: null,
    subtitle: null,
    stats: null,
    body: { kind: "payloads", input: toolInput, output: toolOutput },
  };
}

function soleStringField(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const values = Object.values(input);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

function isEmptyOutput(output: unknown): boolean {
  return output === null || output === undefined || output === "";
}

const GROUP_LABELS: Record<string, [verb: string, singular: string, plural: string]> =
  {
    Read: ["Read", "file", "files"],
    Write: ["Wrote", "file", "files"],
    Edit: ["Edited", "file", "files"],
    Bash: ["Ran", "command", "commands"],
    Grep: ["Searched", "pattern", "patterns"],
    Glob: ["Found", "lookup", "lookups"],
    WebSearch: ["Searched the web", "query", "queries"],
  };

/** "Read 2 files" · "Ran 3 commands" · "speak 2 calls". */
export function describeToolCallGroup(toolName: string, count: number): string {
  const known = GROUP_LABELS[toolName];
  const [verb, singular, plural] = known ?? [
    displayToolName(toolName),
    "call",
    "calls",
  ];
  return `${verb} ${count} ${count === 1 ? singular : plural}`;
}
