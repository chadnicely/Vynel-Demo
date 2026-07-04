// The voice relay's first spoken line — an INSTANT, contextual acknowledgment
// matched to the user's request by keyword. No LLM, so it can be spoken before
// the relay to root even starts (zero added latency). "Checking your schedules"
// confirms the assistant heard WHAT you asked, where a generic "let me check"
// doesn't — but it stays a cheap keyword match, not understanding.
//
// Pure + deterministic: the same transcript always yields the same ack (the pick
// is keyed off the transcript length), so different requests vary naturally while
// staying testable. Falls back to a neutral ack when no intent matches.

interface AckIntent {
  readonly pattern: RegExp
  readonly acks: readonly string[]
}

// Ordered most-specific-topic first; the first matching intent wins. Topic
// intents (schedules, workspaces, …) precede the generic action intent so
// "create a schedule" acks about schedules rather than a bare "working on it".
const ACK_INTENTS: readonly AckIntent[] = [
  {
    pattern: /\b(schedule|scheduled|schedules|remind|reminder|reminders|recurring|cron)\b/i,
    acks: ['Checking your schedules.', 'Let me look at your schedules.'],
  },
  {
    pattern: /\b(remember|memory|memories|recall|noted)\b/i,
    acks: ['Let me check your memory.', 'Looking that up for you.'],
  },
  {
    pattern: /\b(workspace|workspaces|project|projects)\b/i,
    acks: ['Looking at your workspaces.', 'Let me check your workspaces.'],
  },
  {
    pattern: /\b(file|files|document|documents|knowledge)\b/i,
    acks: ['Searching your files.', 'Let me look through your files.'],
  },
  {
    pattern: /\b(channel|channels|telegram|discord)\b/i,
    acks: ['Checking your channels.', 'Let me look at your channels.'],
  },
  {
    pattern: /\b(skill|skills|agent|agents|marketplace)\b/i,
    acks: ['Let me check that for you.', 'One moment, looking.'],
  },
  {
    pattern: /\b(create|build|make|draft|write|generate|set up|setup|add)\b/i,
    acks: ['On it — let me get started.', 'Sure, working on that.'],
  },
]

const DEFAULT_ACKS: readonly string[] = ['Let me check.', 'One moment.', 'Let me find out.', 'On it.']

export function pickAckForRequest(transcript: string): string {
  for (const intent of ACK_INTENTS) {
    if (intent.pattern.test(transcript)) return pick(intent.acks, transcript)
  }
  return pick(DEFAULT_ACKS, transcript)
}

// Deterministic per transcript (keyed off length) — varied across requests,
// stable for a given one.
function pick(acks: readonly string[], transcript: string): string {
  return acks[transcript.length % acks.length] ?? 'Let me check.'
}
