// The per-message channel marker (channel pipeline, Chad locked 2026-07-27) —
// the voice-turn-marker precedent: a system-prompt block decays on the long
// root session, so the instruction that makes the model REPLY THROUGH THE TOOL
// rides ON the message, every time. Appended to PROVIDER INPUT ONLY (the
// persisted row stays the clean inbound text — the run-global-root-turn-core
// voice block is the one home for that split).

export interface ChannelTurnMarkerInput {
  /** The channel's kind, e.g. 'telegram' — spoken to the model in caps. */
  channelKind: string
  /** Group room facts; null for a direct message. */
  group: { senderDescription: string; title: string | null } | null
}

export function composeChannelTurnMarker(input: ChannelTurnMarkerInput): string {
  const kind = input.channelKind.toUpperCase()
  const from =
    input.group !== null
      ? `from ${input.group.senderDescription} in ${
          input.group.title !== null ? `group "${input.group.title}"` : 'a group chat'
        }`
      : 'as a direct message'
  const threading = input.group !== null ? ' — it will thread onto their message' : ''
  return (
    `(This message arrived via ${kind} ${from}. Reply by CALLING the ` +
    `reply_to_channel tool with your answer${threading}; the reply goes back to ` +
    `exactly where this came from. Plain chat text is NOT delivered to the channel.)`
  )
}
