// The catalog of what a monitor may subscribe to — the ONE home for which
// outbox types are offered to the model, and what each one means.
//
// WHY CURATED RATHER THAN "every outbox type": there are 60-odd, most of them
// bookkeeping the agent itself causes (`task.updated` firing on its own
// update). Offering all of them invites monitors that fire on their author's
// own writes. This list is the subset where "wake me when this happens" is a
// sensible thing to want. Adding one is a one-line change; the entry is the
// documentation the model reads.
//
// `filterableFields` names the payload fields usable in `payloadFilter` for
// that type. It matters: a filter on a field the payload doesn't carry can
// never match, and an armed-but-unmatchable monitor is indistinguishable from
// one that is simply still waiting.

export interface WatchableEventType {
  type: string
  description: string
  filterableFields: string[]
}

export const WATCHABLE_EVENT_TYPES: readonly WatchableEventType[] = [
  {
    type: 'task.completed',
    description: 'A task on the user’s task list was marked done.',
    filterableFields: ['taskId', 'workspaceId', 'planId'],
  },
  {
    type: 'plan.completed',
    description: 'A dated plan was completed.',
    filterableFields: ['planId', 'workspaceId', 'planDate'],
  },
  {
    type: 'app.started',
    description: 'A workspace app was started and is running.',
    filterableFields: ['appId', 'workspaceId'],
  },
  {
    type: 'app.stopped',
    description: 'A workspace app was stopped.',
    filterableFields: ['appId', 'workspaceId'],
  },
  {
    type: 'app.crashed',
    description:
      'A workspace app exited unexpectedly — watch this to react to a dev server dying.',
    filterableFields: ['appId', 'workspaceId'],
  },
  {
    type: 'schedule.run-completed',
    description: 'A scheduled task finished its run.',
    filterableFields: ['scheduleId', 'workspaceId'],
  },
  {
    type: 'schedule.run-failed',
    description: 'A scheduled task errored during its run.',
    filterableFields: ['scheduleId', 'workspaceId'],
  },
  {
    type: 'schedule.run-missed',
    description:
      'A scheduled task’s slot passed while Vynel was not running — the run never happened.',
    filterableFields: ['scheduleId', 'workspaceId'],
  },
  {
    type: 'agent.run-completed',
    description: 'A configured agent finished a run.',
    filterableFields: ['agentId', 'workspaceId'],
  },
  {
    type: 'knowledge.document-indexed',
    description:
      'A document finished indexing and is searchable — watch this before searching freshly added sources.',
    filterableFields: ['documentId', 'workspaceId'],
  },
  {
    type: 'approval.user-resolved',
    description: 'The user approved or denied an approval card.',
    filterableFields: ['approvalRequestId', 'workspaceId', 'resolutionKind'],
  },
  {
    type: 'ask.resolved',
    description: 'The user answered a question you asked them.',
    filterableFields: ['askId', 'workspaceId'],
  },
  {
    type: 'channel.connected',
    description: 'A channel (Telegram, Zoom) finished connecting.',
    filterableFields: ['channelId'],
  },
  {
    type: 'channel.group-discovered',
    description: 'The bot was added to a group chat and is waiting to be approved.',
    filterableFields: ['channelId', 'groupId'],
  },
  {
    type: 'workspace.created',
    description: 'A new workspace was created.',
    filterableFields: ['workspaceId'],
  },
  {
    type: 'monitor.expired',
    description:
      'A monitor reached its deadline. Watch this to learn that a watch you armed died without ever firing (filter firedCount: "0").',
    filterableFields: ['monitorId', 'workspaceId', 'firedCount'],
  },
  {
    type: 'process.completed',
    description:
      'A background process exited cleanly (code 0) — the payload carries the output tail. run_background_process arms this watch for you automatically.',
    filterableFields: ['processId', 'workspaceId'],
  },
  {
    type: 'process.failed',
    description:
      'A background process failed — a non-zero exit, a kill, a timeout, or a restart; the payload says which and carries the output tail.',
    filterableFields: ['processId', 'workspaceId'],
  },
]

const WATCHABLE_TYPE_SET = new Set(WATCHABLE_EVENT_TYPES.map((entry) => entry.type))

/** The types NOT in the catalog, so the route can reject a typo at the boundary
 *  rather than arming a watch that can never fire. */
export function rejectUnwatchableTypes(eventTypes: readonly string[]): string[] {
  return eventTypes.filter((type) => !WATCHABLE_TYPE_SET.has(type))
}

// The catalog rendered INTO the arming tools' descriptions rather than served
// by a `list_watchable_events` tool of its own.
//
// WHY NOT A TOOL: the generator's surfaces are mutually exclusive
// (`nonRouting = !isRouting`), so a root-surface catalog tool would be
// unreachable from the plain workspace array — a schedule fire or spawned
// session could arm a monitor but never look up what it may watch, and would
// guess type strings into a 400. Two differently-named catalog tools for one
// static list is worse. Inlining puts the valid types exactly where the model
// decides what to pass, keeps both doors in sync from one constant, and saves
// a round-trip before every arming.
export const WATCHABLE_EVENT_TYPES_FOR_PROMPT = WATCHABLE_EVENT_TYPES.map(
  (entry) =>
    `- \`${entry.type}\` — ${entry.description} Filterable: ${entry.filterableFields.join(', ')}.`,
).join('\n')
