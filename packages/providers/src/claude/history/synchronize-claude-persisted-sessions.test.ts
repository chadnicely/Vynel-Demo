// Tests for `synchronizeClaudePersistedSessions` — scans a temp projects
// directory of session JSONL files and builds `PersistedSessionRecord[]`.
// `getClaudeProjectsDirectoryPath` is pointed at the temp dir; the rest of the
// storage helper runs for real.
// See `docs/blueprints/providers/blueprint.md §11.5` + `§19`.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectsDirectoryHolder = vi.hoisted(() => ({ value: '' }))

vi.mock('./claude-session-storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./claude-session-storage.js')>()
  return { ...actual, getClaudeProjectsDirectoryPath: () => projectsDirectoryHolder.value }
})

import { synchronizeClaudePersistedSessions } from './synchronize-claude-persisted-sessions.js'

async function writeSession(
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
  projectsDirectoryHolder.value = await mkdtemp(path.join(os.tmpdir(), 'vynel-sync-'))
})

afterEach(async () => {
  await rm(projectsDirectoryHolder.value, { recursive: true, force: true })
})

describe('synchronizeClaudePersistedSessions', () => {
  it('returns an empty array when the projects directory does not exist', async () => {
    await rm(projectsDirectoryHolder.value, { recursive: true, force: true })
    expect(await synchronizeClaudePersistedSessions()).toEqual([])
  })

  it('builds a record per session — workspacePath from cwd, preview from the first prompt', async () => {
    await writeSession('-work-demo', 'sess-1', [
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'first question' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-22T08:00:02.000Z',
        message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      },
      {
        type: 'user',
        timestamp: '2026-05-22T08:01:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'second question' },
      },
    ])

    const sessions = await synchronizeClaudePersistedSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      providerId: 'claude',
      sessionId: 'sess-1',
      workspacePath: '/work/demo',
      firstUserMessagePreview: 'first question',
      turnCount: 2,
      hasUnresolvedToolUse: false,
    })
    expect(sessions[0]?.startedAt).toEqual(new Date('2026-05-22T08:00:00.000Z'))
  })

  it('flags hasUnresolvedToolUse when a tool_use has no matching tool_result', async () => {
    await writeSession('-work-demo', 'sess-stuck', [
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'do it' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-22T08:00:01.000Z',
        message: {
          id: 'm1',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_open', name: 'Bash', input: {} }],
        },
      },
    ])

    const sessions = await synchronizeClaudePersistedSessions()
    expect(sessions[0]?.hasUnresolvedToolUse).toBe(true)
  })

  it('does not flag hasUnresolvedToolUse when every tool_use is resolved', async () => {
    await writeSession('-work-demo', 'sess-ok', [
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'do it' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-22T08:00:01.000Z',
        message: {
          id: 'm1',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_done', name: 'Bash', input: {} }],
        },
      },
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:02.000Z',
        cwd: '/work/demo',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_done', content: 'ok' }],
        },
      },
    ])

    const sessions = await synchronizeClaudePersistedSessions()
    expect(sessions[0]?.hasUnresolvedToolUse).toBe(false)
  })

  it('excludes sidechain traffic from turnCount and the unresolved-tool check', async () => {
    await writeSession('-work-demo', 'sess-sidechain', [
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'main prompt' },
      },
      {
        type: 'user',
        isSidechain: true,
        timestamp: '2026-05-22T08:00:01.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'subagent prompt' },
      },
      {
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-05-22T08:00:02.000Z',
        message: {
          id: 'sub',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_sub', name: 'Bash', input: {} }],
        },
      },
    ])

    const sessions = await synchronizeClaudePersistedSessions()
    expect(sessions[0]?.turnCount).toBe(1)
    expect(sessions[0]?.hasUnresolvedToolUse).toBe(false)
  })

  it('honours the `since` cutoff by file mtime', async () => {
    await writeSession('-work-demo', 'sess-old', [
      {
        type: 'user',
        timestamp: '2020-01-01T00:00:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'old' },
      },
    ])
    // A cutoff in the future — the just-written file's mtime is older than it.
    const futureCutoff = new Date(Date.now() + 60_000)
    expect(await synchronizeClaudePersistedSessions(futureCutoff)).toEqual([])
  })

  it('skips meta records when counting turns and choosing the preview', async () => {
    await writeSession('-work-demo', 'sess-meta', [
      {
        type: 'user',
        isMeta: true,
        timestamp: '2026-05-22T08:00:00.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: '<local-command-caveat> ...' },
      },
      {
        type: 'user',
        timestamp: '2026-05-22T08:00:01.000Z',
        cwd: '/work/demo',
        message: { role: 'user', content: 'the real prompt' },
      },
    ])

    const sessions = await synchronizeClaudePersistedSessions()
    expect(sessions[0]?.firstUserMessagePreview).toBe('the real prompt')
    expect(sessions[0]?.turnCount).toBe(1)
  })
})
