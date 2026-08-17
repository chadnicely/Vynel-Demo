// `buildContinuityContext` — the contextBuilder: the ONE home that composes the
// carry a fresh session is seeded with when a continuing identity swaps
// (docs/module-notes/session-continuity.md §4.3). Every seed goes through here
// so the hand-off never drifts between runners:
//
//   1. IDENTITY  — who this conversation is (the primary's scope + name).
//   2. SUMMARY   — the provider's distilled hand-off (the caller's summarize).
//   3. TAIL      — the last messages VERBATIM, so the concrete wording of the
//                  latest exchange survives the distill.
//   4. REFS      — the superseded segment id + "the chain is recorded".
//   5. RECOVERY  — how to gather more on demand (session / memory / knowledge /
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
import { findWorkspaceById } from '@vynel/workspaces'
import type { ChatMessage } from '@vynel/chat/repositories'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionRow } from '../repositories/index.js'
import { listSessionChainTailMessages, resolveListedOriginTitle } from './resolve-primary-transcript.js'

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

const RECOVERY_INSTRUCTIONS = [
  'HOW TO RECOVER MORE (on demand — pull what the next step needs, do not preload everything):',
  '- The full earlier conversation is RECORDED across your segment chain. If session tools are',
  '  available: `get_chat_session` with the previous segment id above reads it in full,',
  '  `search_chat_messages` finds specifics, `list_sessions` shows every session (the global',
  '  assistant thread itself is summarized here, not readable by id).',
  '- If memory / knowledge / journal tools are available: memory (`search_memory`,',
  '  `list_memory_entries`), knowledge (`search_knowledge`) and the journal',
  '  (`list_journal_entries`) hold what was saved deliberately — check them before',
  '  re-deriving anything.',
  '- The notebook book `session-continuity` (`read_playbook`) has the full recovery routine.',
  '- Do not restart finished work; continue from where the hand-off leaves off. Never mix in',
  "  another session's context — this carry is yours alone.",
].join('\n')

export function buildContinuityContext(
  db: Database,
  input: BuildContinuityContextInput,
): ContinuityContext {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  if (!primary || primary.userId !== input.userId) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }

  const identityLine = describeIdentity(db, primary, input.fromSdkSessionId)
  const tail = readTail(db, input)
  const summary = input.summary?.trim() ?? ''

  const sections: string[] = [
    `IDENTITY: You are ${identityLine}. This context was carried over from your previous session segment (${input.fromSdkSessionId}) when it neared its context limit — the same conversation continues here; the full history stays recorded.`,
  ]
  if (summary.length > 0) sections.push(`HAND-OFF SUMMARY:\n${summary}`)
  if (tail.lines.length > 0) {
    sections.push(`LAST MESSAGES (verbatim, oldest first, newest last):\n${tail.lines.join('\n')}`)
  }
  sections.push(RECOVERY_INSTRUCTIONS)

  return { carry: sections.join('\n\n'), identityLine, tailMessageCount: tail.lines.length }
}

// The identity's own description — scope + its own name, from its own rows.
function describeIdentity(db: Database, primary: PrimarySessionRow, fromSdkSessionId: string): string {
  const workspaceName =
    primary.workspaceId !== null ? findWorkspaceById(db, primary.workspaceId)?.name ?? null : null
  const ground = workspaceName !== null ? `workspace “${workspaceName}”` : 'the global scope'
  switch (primary.scope) {
    case 'global':
      return "the global assistant — the continuing conversation above all of the user's workspaces"
    case 'voice':
      return "the user's voice conversation — the continuing spoken thread above all workspaces"
    case 'workspace':
      return `the continuing main conversation of ${workspaceName !== null ? `workspace “${workspaceName}”` : 'this workspace'}`
    case 'spawned': {
      // Its name lives on its LISTED identity row (the chain's origin) — a
      // swap never moves it; a mid-chain "Continued conversation" is not a name.
      const name = resolveListedOriginTitle(db, { userId: primary.userId, headSessionId: fromSdkSessionId })
      return `the spawned session${name !== null ? ` “${name}”` : ''}, grounded in ${ground}`
    }
    case 'agent': {
      const name = resolveListedOriginTitle(db, { userId: primary.userId, headSessionId: fromSdkSessionId })
      const slug = primary.scopeRef !== null ? ` (agent “${primary.scopeRef}”)` : ''
      return `the agent colleague${name !== null ? ` “${name}”` : ''}${slug}, grounded in ${ground}`
    }
  }
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
