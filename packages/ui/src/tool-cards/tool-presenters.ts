import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";

// Presentation logic for tool calls — turns a raw {toolName, toolInput,
// toolOutput} row into what a non-technical person should SEE: "Read
// pricing.md" with highlighted file content, not a JSON dump. Pure functions;
// unknown tools fall back to the generic payload panes.

export type ToolCallBody =
  | { kind: "code"; code: string; language: string; startLine?: number }
  | { kind: "diff"; language: string; removed: string; added: string }
  | { kind: "terminal"; command: string; output: string }
  | { kind: "text"; text: string }
  | { kind: "payloads"; input: unknown; output: unknown };

export interface ToolCallPresentation {
  /** The action word — "Read", "Edit", "Bash", or the raw tool name. */
  verb: string;
  /** The human-meaningful argument — a file name, a command, a pattern. */
  argument: string | null;
  /** Fuller context shown when expanded — usually the absolute path. */
  subtitle: string | null;
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

function baseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || filePath;
}

function asDisplayString(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
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

export function presentToolCall(
  toolCall: ChatToolCallResponse,
): ToolCallPresentation {
  const { toolName, toolInput, toolOutput } = toolCall;
  const filePath = inputField(toolInput, "file_path");

  if (toolName === "Read" && filePath) {
    return {
      verb: "Read",
      argument: baseName(filePath),
      subtitle: filePath,
      body: {
        kind: "code",
        code: asDisplayString(toolOutput),
        language: languageForFilePath(filePath),
        startLine: inputNumberField(toolInput, "offset") ?? 1,
      },
    };
  }

  if (toolName === "Write" && filePath) {
    return {
      verb: "Write",
      argument: baseName(filePath),
      subtitle: filePath,
      body: {
        kind: "code",
        code: inputField(toolInput, "content") ?? asDisplayString(toolInput),
        language: languageForFilePath(filePath),
      },
    };
  }

  if (toolName === "Edit" && filePath) {
    return {
      verb: "Edit",
      argument: baseName(filePath),
      subtitle: filePath,
      body: {
        kind: "diff",
        language: languageForFilePath(filePath),
        removed: inputField(toolInput, "old_string") ?? "",
        added: inputField(toolInput, "new_string") ?? "",
      },
    };
  }

  if (toolName === "Bash") {
    const command = inputField(toolInput, "command") ?? "";
    return {
      verb: "Bash",
      argument:
        command.length > 48 ? `${command.slice(0, 48)}…` : command || null,
      subtitle: null,
      body: { kind: "terminal", command, output: asDisplayString(toolOutput) },
    };
  }

  if (toolName === "Grep" || toolName === "Glob") {
    const pattern = inputField(toolInput, "pattern") ?? "";
    return {
      verb: toolName,
      argument: pattern || null,
      subtitle: inputField(toolInput, "glob") ?? inputField(toolInput, "path"),
      body: { kind: "text", text: asDisplayString(toolOutput) },
    };
  }

  return {
    verb: toolName,
    argument: null,
    subtitle: null,
    body: { kind: "payloads", input: toolInput, output: toolOutput },
  };
}

const GROUP_NOUNS: Record<string, [singular: string, plural: string]> = {
  Read: ["file", "files"],
  Write: ["file", "files"],
  Edit: ["file", "files"],
  Bash: ["command", "commands"],
  Grep: ["search", "searches"],
  Glob: ["lookup", "lookups"],
};

/** "Read 2 files" · "Bash 3 commands" · "my-tool 2 calls". */
export function describeToolCallGroup(toolName: string, count: number): string {
  const [singular, plural] = GROUP_NOUNS[toolName] ?? ["call", "calls"];
  return `${toolName} ${count} ${count === 1 ? singular : plural}`;
}
