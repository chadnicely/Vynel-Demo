// Tests for `fetchClaudePersistedSessionTranscript`. The storage helper's
// `getClaudeProjectsDirectoryPath` is pointed at a temp directory; `encode` +
// `readClaudeSessionJsonlRecords` run for real against the real filesystem.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectsDirectoryHolder = vi.hoisted(() => ({ value: '' }))

vi.mock('./claude-session-storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./claude-session-storage.js')>()
  return { ...actual, getClaudeProjectsDirectoryPath: () => projectsDirectoryHolder.value }
})

import { NotFoundError } from '@vynel/errors'
import { fetchClaudePersistedSessionTranscript } from './fetch-claude-persisted-session-transcript.js'

const WORKSPACE_PATH = '/work/demo'
const ENCODED_WORKSPACE_DIRECTORY = '-work-demo' // encodeWorkspacePathToProjectDirectoryName('/work/demo')
const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444'

async function writeSessionJsonl(
  projectDirectoryName: string,
  sessionId: string,
  lines: unknown[],
): Promise<void> {
  const directory = path.join(projectsDirectoryHolder.value, projectDirectoryName)
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, `${sessionId}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join('\n'),
    'utf8',
  )
}

beforeEach(async () => {
  projectsDirectoryHolder.value = await mkdtemp(path.join(os.tmpdir(), 'vynel-projects-'))
})

afterEach(async () => {
  await rm(projectsDirectoryHolder.value, { recursive: true, force: true })
})

describe('fetchClaudePersistedSessionTranscript', () => {
  it('reconstructs content events from the encoded-path JSONL', async () => {
    await writeSessionJsonl(ENCODED_WORKSPACE_DIRECTORY, SESSION_ID, [
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:00.000Z',
        cwd: WORKSPACE_PATH,
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-22T08:00:05.000Z',
        message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'Hi there.' }] },
      },
    ])

    const transcript = await fetchClaudePersistedSessionTranscript({
      workspacePath: WORKSPACE_PATH,
      sessionId: SESSION_ID,
    })

    expect(transcript.providerId).toBe('claude')
    expect(transcript.sessionId).toBe(SESSION_ID)
    expect(transcript.startedAt).toEqual(new Date('2026-05-22T08:00:00.000Z'))
    expect(transcript.events).toEqual([
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_1',
        textDelta: 'Hi there.',
        isFinalChunk: true,
      },
    ])
  })

  it('falls back to scanning project directories when the encoding does not match', async () => {
    // Written under an unrelated directory name — the encoded path will miss.
    await writeSessionJsonl('some-other-encoded-dir', SESSION_ID, [
      {
        type: 'assistant',
        timestamp: '2026-05-22T09:00:00.000Z',
        message: {
          id: 'msg_x',
          role: 'assistant',
          content: [{ type: 'text', text: 'Found by scan.' }],
        },
      },
    ])

    const transcript = await fetchClaudePersistedSessionTranscript({
      workspacePath: WORKSPACE_PATH,
      sessionId: SESSION_ID,
    })

    expect(transcript.events).toEqual([
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_x',
        textDelta: 'Found by scan.',
        isFinalChunk: true,
      },
    ])
  })

  it('attributes a tool_result to the assistant message that issued the tool_use', async () => {
    await writeSessionJsonl(ENCODED_WORKSPACE_DIRECTORY, SESSION_ID, [
      {
        type: 'assistant',
        timestamp: '2026-05-22T08:00:00.000Z',
        message: {
          id: 'msg_tool',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_9', name: 'Read', input: {} }],
        },
      },
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_9', content: 'ok' }],
        },
      },
    ])

    const transcript = await fetchClaudePersistedSessionTranscript({
      workspacePath: WORKSPACE_PATH,
      sessionId: SESSION_ID,
    })

    const completed = transcript.events.find((event) => event.kind === 'tool-use-completed')
    expect(completed).toMatchObject({ toolUseId: 'tu_9', parentMessageId: 'msg_tool' })
  })

  it('throws NotFoundError when no JSONL exists for the session', async () => {
    await expect(
      fetchClaudePersistedSessionTranscript({
        workspacePath: WORKSPACE_PATH,
        sessionId: SESSION_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
