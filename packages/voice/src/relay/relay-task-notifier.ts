// The async fire-and-notify centerpiece (voice-relay-design.md §4).
//
// When the voice relay hands a real task to the root brain, it does NOT sit on
// the stream — it frees the mic and lets this notifier watch the task in the
// background. The shell registers the task at delegation, feeds it each
// NormalizedSessionEvent as the /root/turn stream arrives, and — when the user
// goes idle — drains the queued spoken notifications to barge in with ("the
// landing page is done."). The user can fire several tasks and keep talking;
// each is tracked independently and announced as it lands.
//
// Stateful by design — a task registry, the kind the naming reference sanctions
// as a class (ApprovalRequestRegistry / SseConnectionPool). Pure of I/O: it
// only ingests events and produces notification objects; the shell speaks them.

import { summarizeTurnForVoice, type VoiceTurnOutcome } from './summarize-turn-for-voice.js'
import type { NormalizedSessionEvent } from '@vynel/providers'

export type RelayTaskStatus = 'running' | VoiceTurnOutcome

export type SpokenNotificationKind = 'progress' | VoiceTurnOutcome

export interface SpokenNotification {
  taskId: string
  label: string
  kind: SpokenNotificationKind
  spokenText: string
}

interface RelayTask {
  taskId: string
  label: string
  status: RelayTaskStatus
  hasAnnouncedProgress: boolean
  events: NormalizedSessionEvent[]
}

const TERMINAL_EVENT_KINDS: ReadonlySet<NormalizedSessionEvent['kind']> = new Set([
  'session-completed',
  'session-errored',
  'session-interrupted',
])

export class RelayTaskNotifier {
  readonly #tasksById = new Map<string, RelayTask>()
  #pendingNotifications: SpokenNotification[] = []

  // The user delegated a task; the shell starts streaming it. Idempotent on taskId.
  registerTask(input: { taskId: string; label: string }): void {
    if (this.#tasksById.has(input.taskId)) return
    this.#tasksById.set(input.taskId, {
      taskId: input.taskId,
      label: input.label,
      status: 'running',
      hasAnnouncedProgress: false,
      events: [],
    })
  }

  // Fold one event from a task's stream: a one-time "underway" ping on the first
  // tool use, a terminal notification when the turn finishes. Events for an
  // unknown or already-finished task are ignored.
  //
  // The shell MUST map the /root/turn `turn-stream-ended` SSE sentinel (which is
  // not a NormalizedSessionEvent kind) onto a terminal event before calling this
  // — otherwise a stream that drops without session-completed/-errored/-interrupted
  // leaves the task 'running' forever (and inflates runningTaskCount).
  ingestEvent(taskId: string, event: NormalizedSessionEvent): void {
    const task = this.#tasksById.get(taskId)
    if (!task || task.status !== 'running') return
    task.events.push(event)

    if (event.kind === 'tool-use-started' && !task.hasAnnouncedProgress) {
      task.hasAnnouncedProgress = true
      this.#pendingNotifications.push({
        taskId,
        label: task.label,
        kind: 'progress',
        spokenText: `${task.label} is underway.`,
      })
      return
    }

    if (TERMINAL_EVENT_KINDS.has(event.kind)) {
      const summary = summarizeTurnForVoice(task.label, task.events)
      task.status = summary.outcome
      this.#pendingNotifications.push({
        taskId,
        label: task.label,
        kind: summary.outcome,
        spokenText: summary.spokenText,
      })
    }
  }

  // True when there's something to announce — the shell checks this at the
  // barge-in moment (user idle + assistant not speaking).
  hasPendingNotifications(): boolean {
    return this.#pendingNotifications.length > 0
  }

  // Drain queued notifications in arrival order (FIFO). The shell speaks them.
  drainNotifications(): SpokenNotification[] {
    const drained = this.#pendingNotifications
    this.#pendingNotifications = []
    return drained
  }

  // How many tasks are still in flight — lets the shell answer "anything still running?".
  runningTaskCount(): number {
    let count = 0
    for (const task of this.#tasksById.values()) {
      if (task.status === 'running') count += 1
    }
    return count
  }
}
