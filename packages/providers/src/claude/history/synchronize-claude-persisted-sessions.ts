// `synchronizeClaudePersistedSessions` — scans the runtime's session storage
// (`~/.claude/projects/**/<sessionId>.jsonl`) and returns a
// `PersistedSessionRecord` per session created or modified since `since`.
// On-demand (NOT a scheduled worker job in Phase 1 — blueprint §13); the
// `chat` domain calls it on workspace open.
//
// `hasUnresolvedToolUse` flags a session whose JSONL holds a `tool_use` with
// no matching `tool_result` — the Phase 1 restart mitigation (blueprint §2 +
// §19): the chat UI offers "resume" for such a session.
// See `docs/blueprints/providers/blueprint.md §11.5` + `§13` + `§19`.

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { PersistedSessionRecord } from '../../shared/persisted-session-record.js'
import {
  getClaudeProjectsDirectoryPath,
  readClaudeSessionJsonlRecords,
  type ClaudeSessionJsonlRecord,
} from './claude-session-storage.js'

const JSONL_EXTENSION = '.jsonl'
const FIRST_MESSAGE_PREVIEW_LENGTH = 120

export async function synchronizeClaudePersistedSessions(
  since?: Date,
): Promise<PersistedSessionRecord[]> {
  const projectsDirectory = getClaudeProjectsDirectoryPath()

  let projectDirectoryNames: string[]
  try {
    projectDirectoryNames = await readdir(projectsDirectory)
  } catch {
    return [] // no projects directory — no persisted sessions
  }

  const sessions: PersistedSessionRecord[] = []
  for (const projectDirectoryName of projectDirectoryNames) {
    const projectDirectory = path.join(projectsDirectory, projectDirectoryName)
    let directoryEntries: string[]
    try {
      directoryEntries = await readdir(projectDirectory)
    } catch {
      continue // a file (not a directory) at the projects root, or unreadable
    }
    for (const directoryEntry of directoryEntries) {
      if (!directoryEntry.endsWith(JSONL_EXTENSION)) continue
      const session = await readPersistedSessionRecord(
        path.join(projectDirectory, directoryEntry),
        directoryEntry.slice(0, -JSONL_EXTENSION.length),
        since,
      )
      if (session !== null) sessions.push(session)
    }
  }

  // Most-recently-active first — the natural order for a chat-session list.
  sessions.sort((a, b) => b.lastModifiedAt.getTime() - a.lastModifiedAt.getTime())
  return sessions
}

async function readPersistedSessionRecord(
  jsonlFilePath: string,
  sessionId: string,
  since: Date | undefined,
): Promise<PersistedSessionRecord | null> {
  let lastModifiedAt: Date
  try {
    lastModifiedAt = (await stat(jsonlFilePath)).mtime
  } catch {
    return null // file vanished between readdir and stat
  }
  if (since !== undefined && lastModifiedAt.getTime() < since.getTime()) {
    return null // unchanged since the cutoff — skip the read
  }

  const records = await readClaudeSessionJsonlRecords(jsonlFilePath)
  if (records.length === 0) return null

  const workspacePath = firstWorkspacePath(records)
  if (workspacePath === null) return null // no `cwd` field — not a real session transcript

  return {
    providerId: 'claude',
    sessionId,
    workspacePath,
    startedAt: earliestTimestamp(records) ?? lastModifiedAt,
    lastModifiedAt,
    firstUserMessagePreview: firstUserMessagePreview(records),
    turnCount: countUserTurns(records),
    hasUnresolvedToolUse: hasUnresolvedToolUse(records),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// The runtime stamps every `user`/`assistant` record with the absolute `cwd`;
// it is the exact workspace path (the encoded directory name is lossy).
function firstWorkspacePath(records: ClaudeSessionJsonlRecord[]): string | null {
  for (const record of records) {
    const cwd = record['cwd']
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  }
  return null
}

function earliestTimestamp(records: ClaudeSessionJsonlRecord[]): Date | null {
  let earliestTime: number | null = null
  for (const record of records) {
    const rawTimestamp = record['timestamp']
    if (typeof rawTimestamp !== 'string') continue
    const time = new Date(rawTimestamp).getTime()
    if (Number.isNaN(time)) continue
    if (earliestTime === null || time < earliestTime) earliestTime = time
  }
  return earliestTime === null ? null : new Date(earliestTime)
}

// A main-thread user prompt: string `content`, not subagent traffic, not a
// tooling-injected meta record.
function isUserPromptRecord(record: ClaudeSessionJsonlRecord): boolean {
  if (record['type'] !== 'user' || record['isSidechain'] === true || record['isMeta'] === true) {
    return false
  }
  const apiMessage = record['message']
  return isRecord(apiMessage) && typeof apiMessage['content'] === 'string'
}

function firstUserMessagePreview(records: ClaudeSessionJsonlRecord[]): string | null {
  for (const record of records) {
    if (!isUserPromptRecord(record)) continue
    const content = (record['message'] as Record<string, unknown>)['content'] as string
    const collapsedContent = content.replace(/\s+/g, ' ').trim()
    if (collapsedContent.length === 0) continue
    return collapsedContent.length > FIRST_MESSAGE_PREVIEW_LENGTH
      ? collapsedContent.slice(0, FIRST_MESSAGE_PREVIEW_LENGTH)
      : collapsedContent
  }
  return null
}

function countUserTurns(records: ClaudeSessionJsonlRecord[]): number {
  let turnCount = 0
  for (const record of records) {
    if (isUserPromptRecord(record)) turnCount += 1
  }
  return turnCount
}

// True when some `tool_use` id has no matching `tool_result` — a session that
// ended mid-tool-use. Sidechain (subagent) traffic is excluded.
function hasUnresolvedToolUse(records: ClaudeSessionJsonlRecord[]): boolean {
  const startedToolUseIds = new Set<string>()
  const resolvedToolUseIds = new Set<string>()

  for (const record of records) {
    if (record['isSidechain'] === true) continue
    const apiMessage = record['message']
    if (!isRecord(apiMessage) || !Array.isArray(apiMessage['content'])) continue

    for (const block of apiMessage['content']) {
      if (!isRecord(block)) continue
      if (
        record['type'] === 'assistant' &&
        block['type'] === 'tool_use' &&
        typeof block['id'] === 'string'
      ) {
        startedToolUseIds.add(block['id'])
      } else if (
        record['type'] === 'user' &&
        block['type'] === 'tool_result' &&
        typeof block['tool_use_id'] === 'string'
      ) {
        resolvedToolUseIds.add(block['tool_use_id'])
      }
    }
  }

  for (const toolUseId of startedToolUseIds) {
    if (!resolvedToolUseIds.has(toolUseId)) return true
  }
  return false
}
