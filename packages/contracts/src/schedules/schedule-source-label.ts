// The ONE reading of how a schedule presents as a message source. Two homes
// consumed it before this file existed — the failed-run notice
// (`consumeScheduleRunFailedEvent`'s reporterLabel) and now the fired prompt's
// system-notice attribution — and a drifted prefix would make the same
// schedule read as two different producers in the chat.

/** The label a schedule wears as a message source — the UI's quiet
 *  system-notice author line ("Schedule · Tea"). */
export function scheduleSourceLabel(displayName: string): string {
  return `Schedule · ${displayName}`
}
