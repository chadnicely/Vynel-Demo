// `buildContinuityContext` — the contextBuilder: the ONE home that composes the
// carry a fresh session is seeded with when a continuing identity swaps
// (docs/module-notes/session-continuity.md §4.3). Every seed goes through here
// so the hand-off never drifts between runners:
//
//   1. IDENTITY  — who this conversation is (the primary's scope + name).
//   2. SUMMARY   — the provider's distilled hand-off (the caller's summarize).
//   3. TAIL      — the last messages VERBATIM, so the concrete wording of the
//                  latest exchange survives the distill.
//   4. CHECKPOINT — the next step the model named when it checkpointed to swap
//                  (§4.6), so the fresh context knows the cut even if the
//                  automatic continuation never runs (cap reached, disconnect).
//   5. REFS      — the superseded segment id + "the chain is recorded".
//   6. RECOVERY  — how to gather more on demand (session / memory / knowledge /
//                  journal tools, the notebook book) — pull, never push.
//
// THE INVARIANT (requirement 4 — no cross context): the builder reads ONLY the
// identity's OWN chain — its own segments' rows, its own summary. It never
// queries another session, another workspace, or a shared store. Cross-feature
// context is the RUNNING session's pull via tools, never this builder's push.
// The tail reader is owner-gated and chain-walked (`listSessionChainTailMessages`),
// so a stranger's rows can never ride into a carry.
//
// The summary is nullable so a caller that could not distill (a session already
// at the ceiling) can still seed identity + tail + refs — the boundary bridge
// itself keeps requiring a usable summary (its fidelity floor); the tail-only
// carry is the forced-bridge follow-up's seam, not a silent downgrade.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import type { ChatMessage } from '@vynel/chat/repositories'
import * as primarySessionsRepository from '../repositories/index.js'
import { peekPendingCheckpoint } from '../continuity/pending-checkpoints.js'
import { listSessionChainTailMessages } from './resolve-primary-transcript.js'
import { describeContinuingIdentity } from './describe-continuing-identity.js'
import { resolveDutyBook, type DutyBook } from './duty-book.js'

export type BuildContinuityContextDeps = {
  /** The duty-book existence lookup — defaults to the verified shelf; tests
   *  inject so the day the books are published needs no test change. */
  bookExists?: (slug: string) => boolean
}

export type BuildContinuityContextInput = {
  primarySessionId: string
  userId: string
  /** The segment being superseded — the head of the identity's own chain at swap time. */
  fromSdkSessionId: string
  /** The distilled hand-off, or null when none could be produced. */
  summary: string | null
  /** Verbatim tail size (non-empty messages). Default `DEFAULT_TAIL_MESSAGE_LIMIT`. */
  tailMessageLimit?: number
}

export type ContinuityContext = {
  /** The composed carry — what the priming turn is seeded with. */
  carry: string
  /** The identity line, exposed for logs + tests. */
  identityLine: string
  /** How many verbatim messages made it into the tail. */
  tailMessageCount: number
}

// Ten non-empty messages is the last few exchanges — enough for the concrete
// wording of what was just being worked on, small enough to leave the summary
// as the carry's spine. Empty bodies (tool-only assistant rows) are skipped
// BEFORE counting, so a tool-heavy turn still yields real text.
export const DEFAULT_TAIL_MESSAGE_LIMIT = 10
// Read past the limit so skipping empty rows usually still fills the tail
// (best-effort: a stretch of pure tool steps can leave it shorter).
const TAIL_READ_MULTIPLIER = 4
// Per-message + whole-tail caps: the carry rides the priming turn's first user
// message — a bounded few thousand chars, never a second transcript.
const TAIL_MESSAGE_MAX_CHARS = 600
const TAIL_TOTAL_MAX_CHARS = 5_000

// The standing pointer to the identity's duty book — the same one line
// `whoami` and the per-kind session instructions carry (§4.5): present or not
// yet published, said honestly either way.
function dutyBookLine(dutyBook: DutyBook): string {
  return dutyBook.exists
    ? `- Your duty book \`${dutyBook.slug}\` is on the shelf — \`read_playbook\` it to re-learn your duty.`
    : `- Your duty book is \`${dutyBook.slug}\` — not published yet; \`whoami\` tells you when it lands.`
}

function recoveryInstructions(dutyBook: DutyBook): string {
  return [
    'HOW TO RECOVER MORE (on demand — pull what the next step needs, do not preload everything):',
    '- `whoami` tells you who you are, how full your context is, and the memory tags that are yours.',
    '- The full earlier conversation is RECORDED across your segment chain. If session tools are',
    '  available: `get_chat_session` with the previous segment id above reads it in full,',
    '  `search_chat_messages` finds specifics, `list_sessions` shows every session. A thread is',
    '  readable only by the identity that owns it — the global assistant reads its own segments,',
    '  nobody else reads them.',
    '- If memory / knowledge / journal tools are available: memory (`search_memory`,',
    '  `list_memory_entries`), knowledge (`search_knowledge`) and the journal',
    '  (`list_journal_entries`) hold what was saved deliberately — check them before',
    '  re-deriving anything.',
    '- The notebook book `session-continuity` (`read_playbook`) has the full recovery routine.',
    dutyBookLine(dutyBook),
    '- Do not restart finished work; continue from where the hand-off leaves off. Never mix in',
    "  another session's context — this carry is yours alone.",
  ].join('\n')
}

export function buildContinuityContext(
  db: Database,
  input: BuildContinuityContextInput,
  deps: BuildContinuityContextDeps = {},
): ContinuityContext {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  if (!primary || primary.userId !== input.userId) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }

  const identity = describeContinuingIdentity(db, primary, input.fromSdkSessionId)
  const identityLine = identity.line
  const dutyBook = resolveDutyBook(
    identity.kind,
    deps.bookExists !== undefined ? { bookExists: deps.bookExists } : {},
  )
  const tail = readTail(db, input)
  const summary = input.summary?.trim() ?? ''

  const sections: string[] = [
    `IDENTITY: You are ${identityLine}. This context was carried over from your previous session segment (${input.fromSdkSessionId}) when it neared its context limit — the same conversation continues here; the full history stays recorded.`,
  ]
  if (summary.length > 0) sections.push(`HAND-OFF SUMMARY:\n${summary}`)
  if (tail.lines.length > 0) {
    sections.push(`LAST MESSAGES (verbatim, oldest first, newest last):\n${tail.lines.join('\n')}`)
  }
  // Peeked, never taken — the runner that continues the work consumes it.
  const checkpoint = peekPendingCheckpoint(db, input.primarySessionId)
  if (checkpoint !== null) {
    sections.push(
      `CHECKPOINT: you stopped here to swap contexts, mid-task. The next step you named: ${checkpoint.nextStep}`,
    )
  }
  sections.push(recoveryInstructions(dutyBook))

  return { carry: sections.join('\n\n'), identityLine, tailMessageCount: tail.lines.length }
}

function readTail(db: Database, input: BuildContinuityContextInput): { lines: string[] } {
  const limit = input.tailMessageLimit ?? DEFAULT_TAIL_MESSAGE_LIMIT
  const messages = listSessionChainTailMessages(db, {
    userId: input.userId,
    headSessionId: input.fromSdkSessionId,
    limit: limit * TAIL_READ_MULTIPLIER,
  })
  const spoken = messages.filter((message) => message.body.trim().length > 0).slice(-limit)
  const lines: string[] = []
  let total = 0
  // Newest first while budgeting (the latest exchange matters most), then
  // restored to chronological order for the model.
  for (const message of [...spoken].reverse()) {
    const line = formatTailLine(message)
    if (total + line.length > TAIL_TOTAL_MAX_CHARS) break
    lines.unshift(line)
    total += line.length
  }
  return { lines }
}

// One line per message: whitespace is flattened so the tail scans as a
// transcript (verbatim wording, not verbatim layout).
function formatTailLine(message: ChatMessage): string {
  const body = message.body.replace(/\s+/g, ' ').trim()
  const clipped = body.length > TAIL_MESSAGE_MAX_CHARS ? `${body.slice(0, TAIL_MESSAGE_MAX_CHARS)}…` : body
  const who = message.sourceLabel !== null ? `${message.role} · ${message.sourceLabel}` : message.role
  return `[${who}] ${clipped}`
}
