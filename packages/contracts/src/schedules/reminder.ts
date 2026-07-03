// The Reminder schedule template — a plain time-based nudge delivered VERBATIM,
// with no LLM turn. "Remind me in 15 minutes to attend my meeting" should arrive
// as the user wrote it, not as a model's rewrite of it. `deliversVerbatim: true`
// tells `fireSchedule` to skip the chat turn and deliver the rendered prompt
// directly (the user's reminder text, with {{placeholders}} resolved).
//
// Typically paired with a one-time `fireAt` ("in 15 minutes") and a Telegram
// channel destination, but works recurring too. Spec: the 2026-06-23 PM run
// (the owner's literal use case) + `.claude/ceo/overnight-2026-06-23-pm.md`.

import type { ScheduleTemplateDefinition } from './schedule-template-catalog.js'

export const reminderTemplate: ScheduleTemplateDefinition = {
  templateKind: 'reminder',
  displayLabel: 'Reminder',
  oneLineDescription: 'A plain reminder delivered to you at a set time — exactly as you wrote it, no AI.',
  iconName: 'bell',
  defaultCronExpression: '0 9 * * *', // a sensible recurring fallback; one-time reminders use fireAt
  defaultDestinationKind: 'chat-and-channel', // a reminder is meant to reach you (e.g. a Telegram DM)
  // Catch-up OFF at the template level (consistent with D4). The headline case —
  // a one-time "remind me in 15 min" missed while offline — still catches up,
  // because createSchedule defaults ONE-TIME schedules (fireAt set) to catch-up.
  defaultCatchUpOnMiss: false,
  defaultApprovalTimeoutMsOverride: null,
  promptTemplate: 'This is your reminder.', // the user overrides with the actual reminder text
  recommendedFor: 'Time-based nudges ("attend your 2pm meeting") delivered as-is — no AI rewriting.',
  deliversVerbatim: true,
}
