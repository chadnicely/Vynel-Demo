// The ONE reading of how a schedule presents as a message source. Two homes
// consumed it before this file existed — the failed-run notice
// (`consumeScheduleRunFailedEvent`'s reporterLabel) and now the fired prompt's
// system-notice attribution — and a drifted prefix would make the same
// schedule read as two different producers in the chat.

/** The prefix every schedule label opens with — the UI reads the producer
 *  KIND off it (`engineReporterKindOf`, chat/engine-reporter-labels.ts). */
export const SCHEDULE_SOURCE_LABEL_PREFIX = 'Schedule · '

/** The label a schedule wears as a message source — the UI's quiet
 *  system-notice author line ("Schedule · Tea"). */
export function scheduleSourceLabel(displayName: string): string {
  return `${SCHEDULE_SOURCE_LABEL_PREFIX}${displayName}`
}
