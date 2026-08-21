// The channel-ANSWER marker (channel report protocol, Kafi 2026-08-22) — the
// sibling of `composeChannelTurnMarker`, for the other end of the round trip.
//
// The turn marker rides an INBOUND channel message: "you were asked from
// Telegram, reply through the tool". This one rides a REPORT arriving back on
// the requester's conversation about work a channel asked for: the person is
// still waiting over there, and the requester is the one who answers them. Same
// per-message reasoning as its sibling (the voice-turn-marker precedent): a
// system-prompt block decays on a long conversation, so the instruction that
// makes the model REPLY THROUGH THE TOOL rides on the message, every time.

export function composeChannelAnswerMarker(input: { channelKind: string }): string {
  return (
    `(This result answers a message that arrived via ${input.channelKind.toUpperCase()}, and ` +
    'the person who asked is still waiting there. Reply to them by CALLING the ' +
    'reply_to_channel tool with what actually matters to them — their answer, in their ' +
    'words, not a status report — then continue as usual. Plain chat text is NOT ' +
    'delivered to the channel.)'
  )
}
