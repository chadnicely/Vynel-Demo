import { describe, it, expect } from 'vitest'
import { RelayTaskNotifier } from './relay-task-notifier.js'
import type { NormalizedSessionEvent } from '@vynel/providers'

const completed = (): NormalizedSessionEvent => ({
  kind: 'session-completed',
  sessionId: 's',
  isNewSession: true,
  completedAt: new Date(0),
})
const errored = (errorMessage: string): NormalizedSessionEvent => ({
  kind: 'session-errored',
  sessionId: 's',
  errorCode: 'x',
  errorMessage,
  isRecoverable: false,
  erroredAt: new Date(0),
})
const toolStart = (): NormalizedSessionEvent => ({
  kind: 'tool-use-started',
  sessionId: 's',
  parentMessageId: 'm',
  toolUseId: 't',
  toolName: 'Write',
  toolInput: {},
  startedAt: new Date(0),
})
const textChunk = (textDelta: string): NormalizedSessionEvent => ({
  kind: 'text-chunk',
  sessionId: 's',
  messageId: 'm',
  textDelta,
  isFinalChunk: false,
})

describe('RelayTaskNotifier', () => {
  it('stays silent until a delegated task finishes, then queues a completion to speak', () => {
    const notifier = new RelayTaskNotifier()
    notifier.registerTask({ taskId: 'a', label: 'the landing page' })
    notifier.ingestEvent('a', textChunk('Built it.'))
    expect(notifier.hasPendingNotifications()).toBe(false) // mic stays free while it runs

    notifier.ingestEvent('a', completed())
    expect(notifier.hasPendingNotifications()).toBe(true)
    const drained = notifier.drainNotifications()
    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({ taskId: 'a', kind: 'completed' })
    expect(drained[0]!.spokenText).toContain('the landing page is done.')
    expect(notifier.hasPendingNotifications()).toBe(false) // draining empties the queue
  })

  it('emits a one-time "underway" progress ping on the first tool use only', () => {
    const notifier = new RelayTaskNotifier()
    notifier.registerTask({ taskId: 'a', label: 'the report' })
    notifier.ingestEvent('a', toolStart())
    notifier.ingestEvent('a', toolStart()) // a second tool use must NOT re-ping
    const drained = notifier.drainNotifications()
    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({ kind: 'progress', spokenText: 'the report is underway.' })
  })

  it('reports a failure outcome', () => {
    const notifier = new RelayTaskNotifier()
    notifier.registerTask({ taskId: 'a', label: 'the deploy' })
    notifier.ingestEvent('a', errored('It crashed.'))
    expect(notifier.drainNotifications()[0]).toMatchObject({ kind: 'failed' })
  })

  it('preserves FIFO arrival order across concurrent tasks and tracks running count', () => {
    const notifier = new RelayTaskNotifier()
    notifier.registerTask({ taskId: 'a', label: 'task A' })
    notifier.registerTask({ taskId: 'b', label: 'task B' })
    expect(notifier.runningTaskCount()).toBe(2)

    notifier.ingestEvent('b', completed()) // B finishes first
    notifier.ingestEvent('a', completed())
    expect(notifier.drainNotifications().map((n) => n.taskId)).toEqual(['b', 'a'])
    expect(notifier.runningTaskCount()).toBe(0)
  })

  it('ignores events for an unknown task and after a task has already finished', () => {
    const notifier = new RelayTaskNotifier()
    notifier.registerTask({ taskId: 'a', label: 'task A' })
    notifier.ingestEvent('unknown', completed()) // unknown task → ignored
    notifier.ingestEvent('a', completed())
    notifier.drainNotifications()
    notifier.ingestEvent('a', completed()) // already finished → no second notification
    expect(notifier.hasPendingNotifications()).toBe(false)
  })

  it('registerTask is idempotent on taskId', () => {
    const notifier = new RelayTaskNotifier()
    notifier.registerTask({ taskId: 'a', label: 'first' })
    notifier.registerTask({ taskId: 'a', label: 'second' }) // ignored — keeps the first
    expect(notifier.runningTaskCount()).toBe(1)
  })
})
