// The schedule template catalog for the `schedules` domain — typed
// constants consumed by BOTH the api and the apps/web panel, so they live in
// `@vynel/contracts` (promoted on the second consumer).
//
// NOTE: `@vynel/contracts` has NO `@vynel/db` dependency (the locked
// workspaces `WorkspaceKind` / channels `ChannelKind` precedent — see
// `workspace-kind-bundles.ts` + `channel-http.ts`). So the two union types
// are re-declared here, kept in sync deliberately with
// `packages/db/src/schema/schedules/schedules.ts`. The blueprint §4 sample's
// `import ... from '@vynel/db/repositories/schedules'` is superseded by this
// locked precedent (on a doc-vs-disk conflict the on-disk precedent wins).

import { morningBriefingTemplate } from './morning-briefing.js'
import { weeklySummaryTemplate } from './weekly-summary.js'
import { emailWatchTemplate } from './email-watch.js'
import { customTemplate } from './custom.js'
import { reminderTemplate } from './reminder.js'

export type ScheduleTemplateKind =
  | 'morning-briefing'
  | 'weekly-summary'
  | 'email-watch'
  | 'custom'
  | 'reminder'

export type ScheduleDestinationKind = 'chat-only' | 'chat-and-channel'

export interface ScheduleTemplateDefinition {
  templateKind: ScheduleTemplateKind
  displayLabel: string
  oneLineDescription: string
  iconName: string // lucide-vue-next
  defaultCronExpression: string
  defaultDestinationKind: ScheduleDestinationKind
  defaultCatchUpOnMiss: boolean
  defaultApprovalTimeoutMsOverride: number | null
  promptTemplate: string // freeform; supports {{placeholders}}
  recommendedFor: string // user-readable hint
  // When true, the schedule fires WITHOUT an LLM turn: the rendered prompt is
  // delivered verbatim (a plain reminder, not an AI rewrite of one). Opt-in —
  // absent/false means the normal MCP-equipped turn runs. Read at fire time by
  // `fireSchedule`. Default false keeps every existing template LLM-driven.
  deliversVerbatim?: boolean
}

export const SCHEDULE_TEMPLATE_CATALOG: readonly ScheduleTemplateDefinition[] = [
  morningBriefingTemplate,
  weeklySummaryTemplate,
  emailWatchTemplate,
  customTemplate,
  reminderTemplate,
] as const

export function findScheduleTemplateByKind(
  templateKind: ScheduleTemplateKind,
): ScheduleTemplateDefinition | null {
  return (
    SCHEDULE_TEMPLATE_CATALOG.find((template) => template.templateKind === templateKind) ?? null
  )
}
