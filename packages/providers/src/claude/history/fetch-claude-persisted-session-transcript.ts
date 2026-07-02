// `fetchClaudePersistedSessionTranscript` — reads one persisted session JSONL
// from the runtime's storage and reconstructs a `ChatSessionTranscript`: a
// NON-live normalized event stream for chat-history display.
//
// `events` carries CONTENT events only (text / thinking / tool-use). Session-
// lifecycle events are not synthesized into a transcript — `startedAt` is a
// sibling field and lifecycle is the live runner's concern. Token-usage
// events are omitted (see `translate-persisted-claude-message.ts`).
// See `docs/blueprints/providers/blueprint.md §7.1` + `§11.5`.

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { NotFoundError } from '@vynel/errors'
import type {
  ChatSessionTranscript,
  FetchTranscriptInput,
} from '../../shared/chat-session-transcript.js'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'
import {
  encodeWorkspacePathToProjectDirectoryName,
  getClaudeProjectsDirectoryPath,
  readClaudeSessionJsonlRecords,
  type ClaudeSessionJsonlRecord,
} from './claude-session-storage.js'
import { translatePersistedClaudeMessage } from './translate-persisted-claude-message.js'

export async function fetchClaudePersistedSessionTranscript(
  input: FetchTranscriptInput,
): Promise<ChatSessionTranscript> {
  const records = await locateAndReadSessionJsonl(input)
  if (records.length === 0) {
    throw new NotFoundError('chat_session', input.sessionId)
  }

  const events: NormalizedSessionEvent[] = []
  let currentAssistantMessageId: string | null = null
  for (const record of records) {
    events.push(
      ...translatePersistedClaudeMessage({
        jsonlRecord: record,
        sessionId: input.sessionId,
        currentAssistantMessageId,
      }),
    )
    currentAssistantMessageId = trackAssistantMessageId(record, currentAssistantMessageId)
  }

  return {
    providerId: 'claude',
    sessionId: input.sessionId,
    startedAt: earliestRecordTimestamp(records),
    events,
  }
}

// Resolves the session JSONL. The encoded-path location is tried first; since
// the path encoding is lossy + OS-specific (blueprint §19), a miss falls back
// to scanning every project directory for `<sessionId>.jsonl` — session ids
// are globally-unique UUIDs, so the filename alone identifies the session.
async function locateAndReadSessionJsonl(
  input: FetchTranscriptInput,
): Promise<ClaudeSessionJsonlRecord[]> {
  const projectsDirectory = getClaudeProjectsDirectoryPath()
  const jsonlFileName = `${input.sessionId}.jsonl`

  const encodedDirectoryPath = path.join(
    projectsDirectory,
    encodeWorkspacePathToProjectDirectoryName(input.workspacePath),
    jsonlFileName,
  )
  const recordsFromEncodedPath = await readClaudeSessionJsonlRecords(encodedDirectoryPath)
  if (recordsFromEncodedPath.length > 0) {
    return recordsFromEncodedPath
  }

  let projectDirectoryNames: string[]
  try {
    projectDirectoryNames = await readdir(projectsDirectory)
  } catch {
    return [] // no projects directory — nothing to scan
  }
  for (const projectDirectoryName of projectDirectoryNames) {
    const candidatePath = path.join(projectsDirectory, projectDirectoryName, jsonlFileName)
    const records = await readClaudeSessionJsonlRecords(candidatePath)
    if (records.length > 0) {
      return records
    }
  }
  return []
}

// Threads the most recent main-thread `assistant` message id so a following
// `user` `tool_result` record is attributed to the message that issued it.
function trackAssistantMessageId(
  record: ClaudeSessionJsonlRecord,
  current: string | null,
): string | null {
  if (record['type'] !== 'assistant' || record['isSidechain'] === true) {
    return current
  }
  const apiMessage = record['message']
  if (typeof apiMessage === 'object' && apiMessage !== null) {
    const messageId = (apiMessage as Record<string, unknown>)['id']
    if (typeof messageId === 'string') return messageId
  }
  return current
}

// The transcript's `startedAt` is the earliest record timestamp. A real
// session JSONL always carries timestamps; `new Date(0)` is the degenerate
// fallback for a file with records but no parseable timestamp.
function earliestRecordTimestamp(records: ClaudeSessionJsonlRecord[]): Date {
  let earliestTime: number | null = null
  for (const record of records) {
    const rawTimestamp = record['timestamp']
    if (typeof rawTimestamp !== 'string') continue
    const time = new Date(rawTimestamp).getTime()
    if (Number.isNaN(time)) continue
    if (earliestTime === null || time < earliestTime) earliestTime = time
  }
  return earliestTime === null ? new Date(0) : new Date(earliestTime)
}
