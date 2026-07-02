// `claude-session-storage` — locating + reading the Claude Code runtime's own
// session storage. Claude Code persists each session as a line-delimited JSON
// file at `~/.claude/projects/<encoded-workspace-path>/<sessionId>.jsonl`.
//
// Shared by `fetch-claude-persisted-session-transcript.ts` (reads one session)
// and `synchronize-claude-persisted-sessions.ts` (scans every session). Vynel
// reads this storage; it never writes it — the runtime owns these files.
// See `docs/blueprints/providers/blueprint.md §11.5` + `§2` + `§19`.

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** A parsed JSONL line. The runtime's transcript-record shape is an opaque
 *  envelope; callers narrow only the fields they read. */
export type ClaudeSessionJsonlRecord = Record<string, unknown>

/** Absolute path to the runtime's per-project session store (`~/.claude/projects`). */
export function getClaudeProjectsDirectoryPath(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

/**
 * Encodes a workspace folder path to the directory name the runtime uses
 * under `~/.claude/projects/`. The runtime replaces every non-alphanumeric
 * character with `-` — `E:\KAFI\WORKSPACE\v2\vynel` becomes
 * `E--KAFI-WORKSPACE-v2-vynel`, `/Users/sam/app` becomes `-Users-sam-app`.
 * The encoding is lossy and not reversible, so callers that need the real
 * workspace path read the `cwd` field inside the JSONL instead.
 */
export function encodeWorkspacePathToProjectDirectoryName(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Reads a session JSONL file and returns its records, one per non-blank line.
 * Resilient by contract: a missing file yields `[]`; a malformed line is
 * skipped rather than throwing — a partially-written transcript still reads.
 */
export async function readClaudeSessionJsonlRecords(
  jsonlFilePath: string,
): Promise<ClaudeSessionJsonlRecord[]> {
  let fileContent: string
  try {
    fileContent = await readFile(jsonlFilePath, 'utf8')
  } catch {
    return [] // file absent or unreadable — no records
  }

  const records: ClaudeSessionJsonlRecord[] = []
  for (const line of fileContent.split('\n')) {
    const trimmedLine = line.trim()
    if (trimmedLine.length === 0) continue
    let parsedLine: unknown
    try {
      parsedLine = JSON.parse(trimmedLine)
    } catch {
      continue // skip a malformed line — a partially-written transcript still reads
    }
    if (typeof parsedLine === 'object' && parsedLine !== null) {
      records.push(parsedLine as ClaudeSessionJsonlRecord)
    }
  }
  return records
}
